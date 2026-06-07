import { prisma } from "@/lib/prisma";
import { assertPositiveCents, formatCents } from "@/domain/money";
import { allocate, validateFundingPlan, type PocketAllocation } from "@/domain/allocation";
import { getMainAccount } from "./balanceService";
import { getActiveFundingPlanInput } from "./funding";
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

export interface PaycheckPreview {
  amountCents: number;
  autoDisperse: boolean;
  allocations: { pocketId: string; pocketName: string; amountCents: number }[];
  freeToSpendCents: number;
  totalSetAsideCents: number;
  hasActivePlan: boolean;
}

/** Preview a paycheck deposit WITHOUT mutating any balances. */
export async function previewPaycheck(
  userId: string,
  amountCents: number,
  autoDisperse = true,
): Promise<PaycheckPreview> {
  assertPositiveCents(amountCents);
  const planInput = autoDisperse ? await getActiveFundingPlanInput(userId) : null;

  if (!planInput) {
    return {
      amountCents,
      autoDisperse,
      allocations: [],
      freeToSpendCents: amountCents,
      totalSetAsideCents: 0,
      hasActivePlan: false,
    };
  }

  const validation = validateFundingPlan(planInput);
  if (!validation.valid) {
    throw new LedgerError(validation.errors.join(" "));
  }

  const result = allocate(amountCents, planInput);
  const pocketIds = result.pocketAllocations.map((a) => a.pocketId);
  const pockets = await prisma.pocket.findMany({ where: { id: { in: pocketIds } } });
  const nameById = new Map(pockets.map((p) => [p.id, p.name]));

  return {
    amountCents,
    autoDisperse,
    allocations: result.pocketAllocations.map((a) => ({
      pocketId: a.pocketId,
      pocketName: nameById.get(a.pocketId) ?? "Pocket",
      amountCents: a.amountCents,
    })),
    freeToSpendCents: result.freeToSpendCents,
    totalSetAsideCents: result.totalSetAsideCents,
    hasActivePlan: true,
  };
}

export interface AddPaycheckInput {
  userId: string;
  amountCents: number;
  autoDisperse?: boolean;
  note?: string;
  idempotencyKey?: string;
}

/**
 * Apply a paycheck/income deposit. Increases the Main Account balance and, when
 * auto_disperse is on and an active plan exists, auto-disperses exactly the
 * deposit amount through the funding plan. Idempotent via idempotencyKey.
 */
export async function addPaycheck(input: AddPaycheckInput) {
  assertPositiveCents(input.amountCents);
  const autoDisperse = input.autoDisperse ?? true;

  return prisma.$transaction(async (tx) => {
    // Idempotency: a repeated request with the same key is a no-op.
    if (input.idempotencyKey) {
      const existing = await tx.moneyMovementBatch.findFirst({
        where: { userId: input.userId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { batchId: existing.id, idempotentReplay: true };
    }

    const account = await getMainAccount(input.userId, tx);

    const transaction = await tx.transaction.create({
      data: {
        userId: input.userId,
        accountId: account.id,
        amountCents: input.amountCents,
        transactionType: "income",
        description: input.note ?? "Paycheck / income deposit",
      },
    });

    const movements: MovementSpec[] = [
      {
        movementType: "MAIN_ACCOUNT_INCREASE",
        amountCents: input.amountCents,
        destinationType: "main_account",
        destinationId: account.id,
      },
    ];

    let allocations: PocketAllocation[] = [];
    let freeToSpendCents = input.amountCents;

    if (autoDisperse) {
      const planInput = await getActiveFundingPlanInput(input.userId, tx);
      if (planInput) {
        const validation = validateFundingPlan(planInput);
        if (!validation.valid) {
          // Block applying an active but invalid plan (per corner cases).
          throw new LedgerError(validation.errors.join(" "));
        }
        const result = allocate(input.amountCents, planInput);
        allocations = result.pocketAllocations;
        freeToSpendCents = result.freeToSpendCents;
        for (const a of allocations) {
          movements.push({
            movementType: "SET_ASIDE_TO_POCKET",
            amountCents: a.amountCents,
            sourceType: "free_to_spend",
            destinationType: "pocket",
            destinationId: a.pocketId,
          });
        }
      }
    }

    if (freeToSpendCents > 0) {
      movements.push({
        movementType: "LEFT_AS_FREE_TO_SPEND",
        amountCents: freeToSpendCents,
        destinationType: "free_to_spend",
      });
    }

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "PAYCHECK_DEPOSIT",
      transactionId: transaction.id,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      movements,
    });

    const statusChanges: StatusChange[] = [];
    for (const a of allocations) {
      const change = await recomputeFullyFunded(tx, a.pocketId);
      if (change) statusChanges.push(change);
    }
    if (statusChanges.length) await recordStatusChanges(tx, batch.id, statusChanges);

    await logActivity(tx, {
      userId: input.userId,
      type: "MONEY_ADDED",
      message: `Paycheck added: ${formatCents(input.amountCents)}`,
      amountCents: input.amountCents,
      accountId: account.id,
      transactionId: transaction.id,
      batchId: batch.id,
    });
    if (allocations.length) {
      const total = allocations.reduce((s, a) => s + a.amountCents, 0);
      await logActivity(tx, {
        userId: input.userId,
        type: "AUTO_ALLOCATED",
        message: `Auto-distributed ${formatCents(total)} across ${allocations.length} pocket(s)`,
        amountCents: total,
        batchId: batch.id,
      });
    }

    for (const change of statusChanges) await notifyIfFullyFunded(tx, input.userId, change);

    return {
      batchId: batch.id,
      transactionId: transaction.id,
      allocatedCents: allocations.reduce((s, a) => s + a.amountCents, 0),
      freeToSpendCents,
      idempotentReplay: false,
    };
  });
}
