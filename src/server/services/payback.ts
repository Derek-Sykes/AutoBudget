import { prisma } from "@/lib/prisma";
import { assertPositiveCents, formatCents } from "@/domain/money";
import type { RestoreMode } from "@/domain/types";
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

const RESTORABLE_STATUSES = ["active", "paused", "fully_funded"];

export interface AddPaybackInput {
  userId: string;
  amountCents: number;
  /** "payback" (reimbursement) or "refund" (merchant/bank). */
  transactionType?: "payback" | "refund";
  restoreMode: RestoreMode;
  linkedBatchId?: string;
  linkedTransactionId?: string;
  manualDestinationType?: "pocket" | "free_to_spend";
  manualDestinationId?: string;
  note?: string;
  idempotencyKey?: string;
}

interface RestoreStep {
  type: "pocket" | "free_to_spend";
  id?: string;
  amountCents: number;
}

/**
 * Payback / refund deposit. Restores prior money movements instead of running
 * paycheck allocation. Never auto-disperses. Increases the Main Account balance
 * and routes the returned money back where it came from (or to an explicit
 * destination / Free to Spend).
 */
export async function addPayback(input: AddPaybackInput) {
  assertPositiveCents(input.amountCents);

  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.moneyMovementBatch.findFirst({
        where: { userId: input.userId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { batchId: existing.id, idempotentReplay: true };
    }

    const account = await getMainAccount(input.userId, tx);

    const steps = await buildRestoreSteps(tx, input);

    const transaction = await tx.transaction.create({
      data: {
        userId: input.userId,
        accountId: account.id,
        amountCents: input.amountCents,
        transactionType: input.transactionType ?? "payback",
        description: input.note ?? "Payback / refund deposit",
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

    for (const step of steps) {
      if (step.type === "pocket") {
        movements.push({
          movementType: "RESTORE_TO_POCKET",
          amountCents: step.amountCents,
          sourceType: "external",
          destinationType: "pocket",
          destinationId: step.id,
        });
      } else {
        movements.push({
          movementType: "RESTORE_TO_FREE_TO_SPEND",
          amountCents: step.amountCents,
          sourceType: "external",
          destinationType: "free_to_spend",
        });
      }
    }

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "PAYBACK_RESTORE",
      transactionId: transaction.id,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      metadata: { linkedBatchId: input.linkedBatchId ?? null, restoreMode: input.restoreMode },
      movements,
    });

    const statusChanges: StatusChange[] = [];
    for (const step of steps) {
      if (step.type === "pocket" && step.id) {
        const change = await recomputeFullyFunded(tx, step.id);
        if (change) statusChanges.push(change);
      }
    }
    if (statusChanges.length) await recordStatusChanges(tx, batch.id, statusChanges);

    await logActivity(tx, {
      userId: input.userId,
      type: "PAYBACK_RESTORE",
      message: `Payback/refund of ${formatCents(input.amountCents)} restored`,
      amountCents: input.amountCents,
      transactionId: transaction.id,
      batchId: batch.id,
    });

    for (const change of statusChanges) await notifyIfFullyFunded(tx, input.userId, change);

    return { batchId: batch.id, idempotentReplay: false };
  });
}

async function buildRestoreSteps(
  tx: Parameters<typeof recomputeFullyFunded>[0],
  input: AddPaybackInput,
): Promise<RestoreStep[]> {
  if (input.restoreMode === "free_to_spend") {
    return [{ type: "free_to_spend", amountCents: input.amountCents }];
  }

  if (input.restoreMode === "manual_destination") {
    if (input.manualDestinationType === "free_to_spend") {
      return [{ type: "free_to_spend", amountCents: input.amountCents }];
    }
    if (input.manualDestinationType === "pocket") {
      const pocket = await tx.pocket.findFirst({
        where: { id: input.manualDestinationId, userId: input.userId },
      });
      if (!pocket) throw new LedgerError("Destination pocket not found.");
      if (!RESTORABLE_STATUSES.includes(pocket.status)) {
        throw new LedgerError("That pocket can no longer receive money. Choose another destination.");
      }
      if (
        pocket.targetAmountCents != null &&
        pocket.currentBalanceCents + input.amountCents > pocket.targetAmountCents
      ) {
        throw new LedgerError(`That would exceed the goal for "${pocket.name}".`);
      }
      return [{ type: "pocket", id: pocket.id, amountCents: input.amountCents }];
    }
    throw new LedgerError("Choose a manual destination.");
  }

  // exact_original_destinations
  const linkedBatch = await tx.moneyMovementBatch.findFirst({
    where: {
      userId: input.userId,
      ...(input.linkedBatchId
        ? { id: input.linkedBatchId }
        : { transactionId: input.linkedTransactionId }),
    },
    include: { movements: { orderBy: { createdAt: "asc" } } },
  });
  if (!linkedBatch) {
    throw new LedgerError("Could not find the original transaction to restore. Link one or choose a destination.");
  }

  const outflows = linkedBatch.movements.filter(
    (m) =>
      m.movementType === "PURCHASE_FROM_POCKET" ||
      m.movementType === "PURCHASE_FROM_FREE_TO_SPEND",
  );
  if (outflows.length === 0) {
    throw new LedgerError("The linked transaction has nothing to restore. Choose a destination instead.");
  }

  const originalSpent = outflows.reduce((s, m) => s + m.amountCents, 0);
  if (input.amountCents > originalSpent) {
    throw new LedgerError(
      `This payback (${formatCents(input.amountCents)}) is larger than the original ${formatCents(originalSpent)}. Reduce it or choose where the extra should go.`,
    );
  }

  // Restore in original movement order (MVP rule).
  const steps: RestoreStep[] = [];
  let remaining = input.amountCents;
  for (const m of outflows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, m.amountCents);
    if (m.movementType === "PURCHASE_FROM_POCKET") {
      const pocket = m.sourceId
        ? await tx.pocket.findUnique({ where: { id: m.sourceId } })
        : null;
      if (!pocket || !RESTORABLE_STATUSES.includes(pocket.status)) {
        throw new LedgerError(
          "The original pocket can no longer receive money. Choose Free to Spend or another active pocket.",
        );
      }
      steps.push({ type: "pocket", id: pocket.id, amountCents: take });
    } else {
      steps.push({ type: "free_to_spend", amountCents: take });
    }
    remaining -= take;
  }
  return steps;
}
