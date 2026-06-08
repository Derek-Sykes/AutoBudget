import { allocate, validateFundingPlan, type FundingPlanInput } from "@/domain/allocation";
import { assertPositiveCents, formatCents, remainingCapacityCents } from "@/domain/money";
import type { Tx } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";
import { getMainAccount } from "./balanceService";
import {
  applyBatch,
  LedgerError,
  recomputeFullyFunded,
  recordStatusChanges,
  type MovementSpec,
  type StatusChange,
} from "./ledger";
import { logActivity } from "./activity";
import { notifyIfFullyFunded } from "./moneyMovement";

export interface CorrectPaycheckInput {
  userId: string;
  batchId: string;
  correctedAmountCents: number;
  updateFutureJobAmount?: boolean;
}

export interface CorrectPaycheckResult {
  batchId: string;
  transactionId: string;
  previousAmountCents: number;
  correctedAmountCents: number;
  deltaCents: number;
  updatedFutureJob: boolean;
}

interface CorrectionMetadata {
  correctsBatchId?: string;
}

function readMetadata(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isCorrectionFor(batch: { metadataJson: string | null }, originalBatchId: string) {
  const meta = readMetadata(batch.metadataJson) as CorrectionMetadata;
  return meta.correctsBatchId === originalBatchId;
}

function payrollJobId(idempotencyKey: string | null): string | null {
  const match = idempotencyKey?.match(/^payroll:([^:]+):\d{4}-\d{2}-\d{2}$/);
  return match?.[1] ?? null;
}

function mainDeltaCents(batch: {
  movements: { movementType: string; amountCents: number }[];
}): number {
  return batch.movements.reduce((sum, movement) => {
    if (movement.movementType === "MAIN_ACCOUNT_INCREASE") return sum + movement.amountCents;
    if (movement.movementType === "MAIN_ACCOUNT_DECREASE") return sum - movement.amountCents;
    return sum;
  }, 0);
}

function pocketContributionDeltas(
  batches: { movements: { movementType: string; amountCents: number; sourceId: string | null; destinationId: string | null }[] }[],
) {
  const byPocket = new Map<string, number>();
  const add = (pocketId: string | null, cents: number) => {
    if (!pocketId || cents === 0) return;
    byPocket.set(pocketId, (byPocket.get(pocketId) ?? 0) + cents);
  };

  for (const batch of batches) {
    for (const movement of batch.movements) {
      if (movement.movementType === "SET_ASIDE_TO_POCKET") {
        add(movement.destinationId, movement.amountCents);
      } else if (movement.movementType === "RELEASE_FROM_POCKET") {
        add(movement.sourceId, -movement.amountCents);
      }
    }
  }

  for (const [pocketId, cents] of byPocket) {
    if (cents === 0) byPocket.delete(pocketId);
  }
  return byPocket;
}

function sumMap(values: Map<string, number>) {
  let sum = 0;
  for (const value of values.values()) sum += value;
  return sum;
}

function toAllocationMap(allocations: { pocketId: string; amountCents: number }[]) {
  const byPocket = new Map<string, number>();
  for (const allocation of allocations) {
    byPocket.set(allocation.pocketId, (byPocket.get(allocation.pocketId) ?? 0) + allocation.amountCents);
  }
  return byPocket;
}

async function getCorrectionFundingPlanInput(
  userId: string,
  tx: Tx,
  currentContributionByPocket: Map<string, number>,
): Promise<FundingPlanInput | null> {
  const plan = await tx.fundingPlan.findFirst({
    where: { userId, isActive: true },
    include: { rules: { where: { active: true } } },
  });
  if (!plan) return null;

  const pockets = await tx.pocket.findMany({ where: { userId, status: "active" } });
  const catRules = plan.rules.filter((rule) => rule.destinationType === "category");
  const pocketRuleWeight = new Map(
    plan.rules
      .filter((rule) => rule.destinationType === "pocket" && rule.destinationId)
      .map((rule) => [rule.destinationId as string, rule.basisPoints ?? 0]),
  );
  const ftsRule = plan.rules.find((rule) => rule.destinationType === "free_to_spend");

  const categories = catRules.map((rule) => {
    const catPockets = pockets.filter((pocket) => pocket.categoryId === rule.destinationId);
    const overflow = catPockets.find((pocket) => pocket.isOverflow);
    const normal = catPockets.filter((pocket) => !pocket.isOverflow);
    return {
      id: rule.destinationId ?? "",
      weightBp: rule.basisPoints ?? 0,
      overflowPocketId: overflow?.id,
      pockets: normal.map((pocket) => {
        const effectiveCurrent =
          pocket.currentBalanceCents - (currentContributionByPocket.get(pocket.id) ?? 0);
        return {
          id: pocket.id,
          weightBp: pocketRuleWeight.get(pocket.id) ?? 0,
          capacityCents: remainingCapacityCents(effectiveCurrent, pocket.targetAmountCents),
        };
      }),
    };
  });

  return { categories, freeToSpendWeightBp: ftsRule?.basisPoints ?? 0 };
}

async function targetPocketContributions(
  userId: string,
  tx: Tx,
  amountCents: number,
  autoDisperse: boolean,
  currentContributionByPocket: Map<string, number>,
) {
  if (!autoDisperse) return new Map<string, number>();

  const planInput = await getCorrectionFundingPlanInput(userId, tx, currentContributionByPocket);
  if (!planInput) return new Map<string, number>();

  const validation = validateFundingPlan(planInput);
  if (!validation.valid) throw new LedgerError(validation.errors.join(" "));

  return toAllocationMap(allocate(amountCents, planInput).pocketAllocations);
}

/**
 * Correct an already-created paycheck by applying only the delta as a new
 * ledger batch. The original paycheck and prior corrections remain intact.
 */
export async function correctPaycheck(input: CorrectPaycheckInput): Promise<CorrectPaycheckResult> {
  assertPositiveCents(input.correctedAmountCents, "Corrected paycheck amount");

  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const original = await tx.moneyMovementBatch.findFirst({
      where: {
        id: input.batchId,
        userId: input.userId,
        batchType: "PAYCHECK_DEPOSIT",
        status: "applied",
      },
      include: { movements: true },
    });
    if (!original) throw new LedgerError("Paycheck not found.");

    const allCorrections = await tx.moneyMovementBatch.findMany({
      where: {
        userId: input.userId,
        batchType: "PAYCHECK_CORRECTION",
        status: "applied",
      },
      include: { movements: true },
      orderBy: { createdAt: "asc" },
    });
    const priorCorrections = allCorrections.filter((batch) => isCorrectionFor(batch, original.id));
    const appliedHistory = [original, ...priorCorrections];

    const previousAmountCents = appliedHistory.reduce((sum, batch) => sum + mainDeltaCents(batch), 0);
    if (input.correctedAmountCents === previousAmountCents) {
      throw new LedgerError("Enter a different paycheck amount to create a correction.");
    }

    const originalMeta = readMetadata(original.metadataJson);
    const originalAutoDisperse =
      typeof originalMeta.autoDisperse === "boolean"
        ? originalMeta.autoDisperse
        : original.movements.some((movement) => movement.movementType === "SET_ASIDE_TO_POCKET");

    const currentContributionByPocket = pocketContributionDeltas(appliedHistory);
    const targetContributionByPocket = await targetPocketContributions(
      input.userId,
      tx,
      input.correctedAmountCents,
      originalAutoDisperse,
      currentContributionByPocket,
    );

    const movements: MovementSpec[] = [];
    const deltaCents = input.correctedAmountCents - previousAmountCents;
    if (deltaCents > 0) {
      movements.push({
        movementType: "MAIN_ACCOUNT_INCREASE",
        amountCents: deltaCents,
        destinationType: "main_account",
        destinationId: account.id,
      });
    } else {
      movements.push({
        movementType: "MAIN_ACCOUNT_DECREASE",
        amountCents: Math.abs(deltaCents),
        sourceType: "main_account",
        sourceId: account.id,
      });
    }

    const affectedPocketIds = new Set([
      ...currentContributionByPocket.keys(),
      ...targetContributionByPocket.keys(),
    ]);
    const pockets = await tx.pocket.findMany({
      where: { userId: input.userId, id: { in: [...affectedPocketIds] } },
    });
    const pocketById = new Map(pockets.map((pocket) => [pocket.id, pocket]));

    let setAsideDeltaCents = 0;
    let requestedReleaseCents = 0;
    let actualReleaseCents = 0;
    for (const pocketId of affectedPocketIds) {
      const current = currentContributionByPocket.get(pocketId) ?? 0;
      const target = targetContributionByPocket.get(pocketId) ?? 0;
      const contributionDelta = target - current;
      if (contributionDelta > 0) {
        movements.push({
          movementType: "SET_ASIDE_TO_POCKET",
          amountCents: contributionDelta,
          sourceType: "free_to_spend",
          destinationType: "pocket",
          destinationId: pocketId,
        });
        setAsideDeltaCents += contributionDelta;
      } else if (contributionDelta < 0) {
        requestedReleaseCents += Math.abs(contributionDelta);
        const availableCents = Math.max(0, pocketById.get(pocketId)?.currentBalanceCents ?? 0);
        const releaseCents = Math.min(Math.abs(contributionDelta), availableCents);
        if (releaseCents > 0) {
          movements.push({
            movementType: "RELEASE_FROM_POCKET",
            amountCents: releaseCents,
            sourceType: "pocket",
            sourceId: pocketId,
            destinationType: "free_to_spend",
          });
          setAsideDeltaCents -= releaseCents;
          actualReleaseCents += releaseCents;
        }
      }
    }

    const freeToSpendDeltaCents = deltaCents - setAsideDeltaCents;
    if (freeToSpendDeltaCents > 0) {
      movements.push({
        movementType: "PAYCHECK_CORRECTION_TO_FREE_TO_SPEND",
        amountCents: freeToSpendDeltaCents,
        destinationType: "free_to_spend",
      });
    } else if (freeToSpendDeltaCents < 0) {
      movements.push({
        movementType: "PAYCHECK_CORRECTION_FROM_FREE_TO_SPEND",
        amountCents: Math.abs(freeToSpendDeltaCents),
        sourceType: "free_to_spend",
      });
    }

    const transaction = await tx.transaction.create({
      data: {
        userId: input.userId,
        accountId: account.id,
        amountCents: Math.abs(deltaCents),
        transactionType: "manual_adjustment",
        description: `Paycheck correction from ${formatCents(previousAmountCents)} to ${formatCents(
          input.correctedAmountCents,
        )}`,
      },
    });

    const jobId = payrollJobId(original.idempotencyKey);
    let updatedFutureJob = false;
    if (input.updateFutureJobAmount && jobId) {
      const job = await tx.job.findFirst({ where: { id: jobId, userId: input.userId } });
      if (!job) throw new LedgerError("Payroll job not found.");
      await tx.job.update({
        where: { id: job.id },
        data: { amountCents: input.correctedAmountCents },
      });
      updatedFutureJob = true;
    }

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "PAYCHECK_CORRECTION",
      transactionId: transaction.id,
      note: `Corrected paycheck to ${formatCents(input.correctedAmountCents)}`,
      metadata: {
        correctsBatchId: original.id,
        previousAmountCents,
        correctedAmountCents: input.correctedAmountCents,
        deltaCents,
        originalAutoDisperse,
        requestedReleaseCents,
        actualReleaseCents,
        freeToSpendDeltaCents,
        payrollJobId: jobId,
        updatedFutureJob,
        targetSetAsideCents: sumMap(targetContributionByPocket),
      },
      movements,
    });

    const statusChanges: StatusChange[] = [];
    for (const pocketId of affectedPocketIds) {
      const change = await recomputeFullyFunded(tx, pocketId);
      if (change) statusChanges.push(change);
    }
    if (statusChanges.length) await recordStatusChanges(tx, batch.id, statusChanges);

    await logActivity(tx, {
      userId: input.userId,
      type: "PAYCHECK_CORRECTED",
      message: `Corrected paycheck from ${formatCents(previousAmountCents)} to ${formatCents(
        input.correctedAmountCents,
      )}`,
      amountCents: Math.abs(deltaCents),
      accountId: account.id,
      transactionId: transaction.id,
      batchId: batch.id,
      metadata: { originalBatchId: original.id, deltaCents, updatedFutureJob },
    });

    for (const change of statusChanges) await notifyIfFullyFunded(tx, input.userId, change);

    return {
      batchId: batch.id,
      transactionId: transaction.id,
      previousAmountCents,
      correctedAmountCents: input.correctedAmountCents,
      deltaCents,
      updatedFutureJob,
    };
  });
}
