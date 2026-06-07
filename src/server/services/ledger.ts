import type { Tx } from "@/lib/prisma";
import {
  MOVEMENT_EFFECTS,
  type BatchType,
  type LocationType,
  type MovementType,
  type PocketStatus,
} from "@/domain/types";
import { isFullyFunded } from "@/domain/money";

export class LedgerError extends Error {}

export interface MovementSpec {
  movementType: MovementType;
  amountCents: number;
  sourceType?: LocationType;
  sourceId?: string | null;
  destinationType?: LocationType;
  destinationId?: string | null;
  reversible?: boolean;
  metadata?: Record<string, unknown>;
}

export interface StatusChange {
  pocketId: string;
  from: PocketStatus;
  to: PocketStatus;
}

export interface ApplyBatchInput {
  userId: string;
  mainAccountId: string;
  batchType: BatchType;
  transactionId?: string | null;
  originalBatchId?: string | null;
  idempotencyKey?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  movements: MovementSpec[];
}

async function adjustAccount(tx: Tx, accountId: string, deltaCents: number): Promise<void> {
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  const next = account.balanceCents + deltaCents;
  if (next < 0) {
    throw new LedgerError("This action would make the Main Account balance negative.");
  }
  await tx.account.update({ where: { id: accountId }, data: { balanceCents: next } });
}

async function adjustPocket(tx: Tx, pocketId: string, deltaCents: number): Promise<void> {
  const pocket = await tx.pocket.findUniqueOrThrow({ where: { id: pocketId } });
  const next = pocket.currentBalanceCents + deltaCents;
  if (next < 0) {
    throw new LedgerError(`This action would make the "${pocket.name}" pocket negative.`);
  }
  await tx.pocket.update({ where: { id: pocketId }, data: { currentBalanceCents: next } });
}

/** Apply (sign=+1) or reverse (sign=-1) a single movement's stored-balance effect. */
async function applyEffect(
  tx: Tx,
  mainAccountId: string,
  spec: Pick<MovementSpec, "movementType" | "amountCents" | "sourceId" | "destinationId">,
  sign: 1 | -1,
): Promise<void> {
  const effect = MOVEMENT_EFFECTS[spec.movementType];
  const delta = effect.direction * sign * spec.amountCents;
  switch (effect.target) {
    case "main_account":
      await adjustAccount(tx, mainAccountId, delta);
      break;
    case "pocket_destination":
      if (!spec.destinationId) throw new LedgerError("Movement is missing a destination pocket.");
      await adjustPocket(tx, spec.destinationId, delta);
      break;
    case "pocket_source":
      if (!spec.sourceId) throw new LedgerError("Movement is missing a source pocket.");
      await adjustPocket(tx, spec.sourceId, delta);
      break;
    case "none":
      break;
  }
}

/**
 * Create an applied MoneyMovementBatch and its MoneyMovement rows, mutating
 * balances through the guarded effect function. Must be called inside a Prisma
 * transaction so a failure rolls the whole batch back.
 */
export async function applyBatch(tx: Tx, input: ApplyBatchInput) {
  const batch = await tx.moneyMovementBatch.create({
    data: {
      userId: input.userId,
      batchType: input.batchType,
      status: "applied",
      transactionId: input.transactionId ?? null,
      originalBatchId: input.originalBatchId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      note: input.note ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });

  for (const m of input.movements) {
    if (m.amountCents < 0 || !Number.isInteger(m.amountCents)) {
      throw new LedgerError("Movement amounts must be non-negative whole cents.");
    }
    await applyEffect(tx, input.mainAccountId, m, 1);
    await tx.moneyMovement.create({
      data: {
        batchId: batch.id,
        movementType: m.movementType,
        amountCents: m.amountCents,
        sourceType: m.sourceType ?? null,
        sourceId: m.sourceId ?? null,
        destinationType: m.destinationType ?? null,
        destinationId: m.destinationId ?? null,
        reversible: m.reversible ?? true,
        metadataJson: m.metadata ? JSON.stringify(m.metadata) : null,
      },
    });
  }

  return batch;
}

/**
 * Recompute a pocket's fully_funded/active status from its balance vs target.
 * Only flips between active and fully_funded; returns the change if any.
 */
export async function recomputeFullyFunded(
  tx: Tx,
  pocketId: string,
): Promise<StatusChange | null> {
  const pocket = await tx.pocket.findUniqueOrThrow({ where: { id: pocketId } });
  const status = pocket.status as PocketStatus;
  if (status !== "active" && status !== "fully_funded") return null;

  const shouldBeFunded = isFullyFunded(pocket.currentBalanceCents, pocket.targetAmountCents);
  const next: PocketStatus = shouldBeFunded ? "fully_funded" : "active";
  if (next === status) return null;

  await tx.pocket.update({ where: { id: pocketId }, data: { status: next } });
  return { pocketId, from: status, to: next };
}

/** Persist status changes onto a batch's metadata so reversal can undo them. */
export async function recordStatusChanges(
  tx: Tx,
  batchId: string,
  changes: StatusChange[],
): Promise<void> {
  if (changes.length === 0) return;
  const batch = await tx.moneyMovementBatch.findUniqueOrThrow({ where: { id: batchId } });
  const meta = batch.metadataJson ? JSON.parse(batch.metadataJson) : {};
  meta.statusChanges = [...(meta.statusChanges ?? []), ...changes];
  await tx.moneyMovementBatch.update({
    where: { id: batchId },
    data: { metadataJson: JSON.stringify(meta) },
  });
}

export interface ReverseResult {
  reversalBatchId: string;
}

/**
 * Safely reverse a clean, applied batch by creating opposite movements. Blocks
 * double reversal and any reversal that would drive a balance negative. Restores
 * pocket statuses recorded in the original batch metadata.
 */
export async function reverseBatch(
  tx: Tx,
  userId: string,
  mainAccountId: string,
  batchId: string,
): Promise<ReverseResult> {
  const batch = await tx.moneyMovementBatch.findFirst({
    where: { id: batchId, userId },
    include: { movements: true, reversalBatches: true },
  });
  if (!batch) throw new LedgerError("Batch not found.");
  if (batch.batchType === "REVERSAL") {
    throw new LedgerError("A reversal batch cannot itself be reversed.");
  }
  if (batch.status !== "applied" || batch.reversalBatches.length > 0) {
    throw new LedgerError("This action has already been reversed.");
  }

  const reversal = await tx.moneyMovementBatch.create({
    data: {
      userId,
      batchType: "REVERSAL",
      status: "applied",
      originalBatchId: batch.id,
      note: `Reversal of ${batch.batchType}`,
    },
  });

  // Apply inverse effects (sign=-1). The guarded effect blocks negatives.
  for (const m of batch.movements) {
    await applyEffect(
      tx,
      mainAccountId,
      {
        movementType: m.movementType as MovementType,
        amountCents: m.amountCents,
        sourceId: m.sourceId,
        destinationId: m.destinationId,
      },
      -1,
    );
    await tx.moneyMovement.create({
      data: {
        batchId: reversal.id,
        movementType: m.movementType,
        amountCents: m.amountCents,
        // Inverse: swap source/destination for an accurate audit trail.
        sourceType: m.destinationType,
        sourceId: m.destinationId,
        destinationType: m.sourceType,
        destinationId: m.sourceId,
        reversible: false,
        originalMovementId: m.id,
        metadataJson: JSON.stringify({ reverses: m.id }),
      },
    });
    await tx.moneyMovement.update({
      where: { id: m.id },
      data: { reversedByMovementId: reversal.id },
    });
  }

  // Restore pocket statuses that this batch changed.
  const meta = batch.metadataJson ? JSON.parse(batch.metadataJson) : {};
  const statusChanges: StatusChange[] = meta.statusChanges ?? [];
  for (const change of statusChanges) {
    await tx.pocket.update({
      where: { id: change.pocketId },
      data: { status: change.from },
    });
  }

  await tx.moneyMovementBatch.update({
    where: { id: batch.id },
    data: { status: "reversed" },
  });

  return { reversalBatchId: reversal.id };
}
