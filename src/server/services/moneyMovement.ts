import { prisma } from "@/lib/prisma";
import { assertPositiveCents, formatCents, isFullyFunded } from "@/domain/money";
import { allocateWithinCategory } from "@/domain/allocation";
import type { LocationType, PocketStatus } from "@/domain/types";
import { getDashboardBalances, getMainAccount } from "./balanceService";
import { getCategoryAllocationInput } from "./funding";
import {
  applyBatch,
  LedgerError,
  recomputeFullyFunded,
  recordStatusChanges,
  type MovementSpec,
  type StatusChange,
} from "./ledger";
import { createNotification, logActivity } from "./activity";

export interface SetAsideInput {
  userId: string;
  pocketId: string;
  amountCents: number;
  note?: string;
}

/**
 * Manual set-aside: move money from Free to Spend into a pocket. Does NOT change
 * the Main Account balance — it only increases Set Aside and reduces derived
 * Free to Spend.
 */
export async function setAsideToPocket(input: SetAsideInput) {
  assertPositiveCents(input.amountCents);

  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const pocket = await tx.pocket.findFirst({
      where: { id: input.pocketId, userId: input.userId },
    });
    if (!pocket) throw new LedgerError("Pocket not found.");
    if (pocket.status !== "active") {
      throw new LedgerError(`You can only set money aside into an active pocket.`);
    }

    const { freeToSpendCents } = await getDashboardBalances(input.userId, tx);
    if (input.amountCents > freeToSpendCents) {
      throw new LedgerError(
        `You only have ${formatCents(freeToSpendCents)} free to spend.`,
      );
    }

    // MVP: block overfunding past target.
    if (
      pocket.targetAmountCents != null &&
      pocket.currentBalanceCents + input.amountCents > pocket.targetAmountCents
    ) {
      throw new LedgerError(
        `That would exceed the ${formatCents(pocket.targetAmountCents)} goal for "${pocket.name}".`,
      );
    }

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "MANUAL_SET_ASIDE",
      note: input.note,
      movements: [
        {
          movementType: "SET_ASIDE_TO_POCKET",
          amountCents: input.amountCents,
          sourceType: "free_to_spend",
          destinationType: "pocket",
          destinationId: pocket.id,
        },
      ],
    });

    const change = await recomputeFullyFunded(tx, pocket.id);
    if (change) await recordStatusChanges(tx, batch.id, [change]);

    await logActivity(tx, {
      userId: input.userId,
      type: "MONEY_SET_ASIDE",
      message: `Set aside ${formatCents(input.amountCents)} into ${pocket.name}`,
      amountCents: input.amountCents,
      pocketId: pocket.id,
      categoryId: pocket.categoryId,
      batchId: batch.id,
    });

    await notifyIfFullyFunded(tx, input.userId, change);

    return { batchId: batch.id };
  });
}

export interface SetAsideToCategoryInput {
  userId: string;
  categoryId: string;
  amountCents: number;
  note?: string;
}

/**
 * Fund a whole category from Free to Spend. The amount is auto-distributed
 * across the category's pockets exactly like a paycheck would distribute that
 * category's share — by the active funding plan's pocket weights, capped at each
 * pocket's goal, with the remainder and any capped overflow landing in the
 * category's Overflow pocket. Does NOT change the Main Account balance; it only
 * moves money from Free to Spend into the category's pockets.
 */
export async function setAsideToCategory(input: SetAsideToCategoryInput) {
  assertPositiveCents(input.amountCents);

  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, userId: input.userId },
    });
    if (!category) throw new LedgerError("Category not found.");
    if (category.status !== "active") {
      throw new LedgerError("You can only fund an active category.");
    }

    const { freeToSpendCents } = await getDashboardBalances(input.userId, tx);
    if (input.amountCents > freeToSpendCents) {
      throw new LedgerError(`You only have ${formatCents(freeToSpendCents)} free to spend.`);
    }

    const catInput = await getCategoryAllocationInput(input.userId, input.categoryId, tx);
    if (!catInput) throw new LedgerError("Category not found.");

    const { allocations } = allocateWithinCategory(input.amountCents, catInput);
    if (allocations.length === 0) {
      throw new LedgerError("This category has no pockets to fund yet.");
    }

    const movements: MovementSpec[] = allocations.map((a) => ({
      movementType: "SET_ASIDE_TO_POCKET",
      amountCents: a.amountCents,
      sourceType: "free_to_spend",
      destinationType: "pocket",
      destinationId: a.pocketId,
    }));

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "MANUAL_SET_ASIDE",
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
      type: "MONEY_SET_ASIDE",
      message: `Set aside ${formatCents(input.amountCents)} into ${category.name}`,
      amountCents: input.amountCents,
      categoryId: category.id,
      batchId: batch.id,
    });

    for (const change of statusChanges) await notifyIfFullyFunded(tx, input.userId, change);

    return { batchId: batch.id };
  });
}

export interface ReallocateInput {
  userId: string;
  sourceType: Extract<LocationType, "pocket" | "free_to_spend">;
  sourceId?: string;
  destinationType: Extract<LocationType, "pocket" | "free_to_spend">;
  destinationId?: string;
  amountCents: number;
  note?: string;
}

/** Move set-aside money between a pocket and Free to Spend (or pocket->pocket). */
export async function reallocate(input: ReallocateInput) {
  assertPositiveCents(input.amountCents);
  if (input.sourceType === "pocket" && !input.sourceId)
    throw new LedgerError("Source pocket is required.");
  if (input.destinationType === "pocket" && !input.destinationId)
    throw new LedgerError("Destination pocket is required.");
  if (
    input.sourceType === input.destinationType &&
    input.sourceId === input.destinationId
  ) {
    throw new LedgerError("Source and destination must differ.");
  }

  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const movements: MovementSpec[] = [];
    const statusChanges: StatusChange[] = [];

    if (input.sourceType === "pocket") {
      const src = await tx.pocket.findFirst({
        where: { id: input.sourceId, userId: input.userId },
      });
      if (!src) throw new LedgerError("Source pocket not found.");
      if (src.currentBalanceCents < input.amountCents) {
        throw new LedgerError(`"${src.name}" only holds ${formatCents(src.currentBalanceCents)}.`);
      }
      movements.push({
        movementType: "RELEASE_FROM_POCKET",
        amountCents: input.amountCents,
        sourceType: "pocket",
        sourceId: src.id,
        destinationType: input.destinationType,
        destinationId: input.destinationId,
      });
    } else {
      // From Free to Spend: ensure enough is free.
      const { freeToSpendCents } = await getDashboardBalances(input.userId, tx);
      if (input.amountCents > freeToSpendCents) {
        throw new LedgerError(`You only have ${formatCents(freeToSpendCents)} free to spend.`);
      }
    }

    if (input.destinationType === "pocket") {
      const dest = await tx.pocket.findFirst({
        where: { id: input.destinationId, userId: input.userId },
      });
      if (!dest) throw new LedgerError("Destination pocket not found.");
      if (dest.status !== "active") {
        throw new LedgerError("You can only move money into an active pocket.");
      }
      if (
        dest.targetAmountCents != null &&
        dest.currentBalanceCents + input.amountCents > dest.targetAmountCents
      ) {
        throw new LedgerError(`That would exceed the goal for "${dest.name}".`);
      }
      movements.push({
        movementType: "SET_ASIDE_TO_POCKET",
        amountCents: input.amountCents,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        destinationType: "pocket",
        destinationId: dest.id,
      });
    }

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "MANUAL_REALLOCATION",
      note: input.note,
      movements,
    });

    for (const pocketId of [input.sourceId, input.destinationId]) {
      if (!pocketId) continue;
      const change = await recomputeFullyFunded(tx, pocketId);
      if (change) statusChanges.push(change);
    }
    if (statusChanges.length) await recordStatusChanges(tx, batch.id, statusChanges);

    await logActivity(tx, {
      userId: input.userId,
      type: "MANUAL_REALLOCATION",
      message: `Moved ${formatCents(input.amountCents)}`,
      amountCents: input.amountCents,
      batchId: batch.id,
    });

    for (const change of statusChanges) await notifyIfFullyFunded(tx, input.userId, change);

    return { batchId: batch.id };
  });
}

/** Shared helper: emit a fully-funded notification for a status change. */
export async function notifyIfFullyFunded(
  tx: Parameters<typeof recomputeFullyFunded>[0],
  userId: string,
  change: StatusChange | null,
) {
  if (!change || change.to !== "fully_funded") return;
  const pocket = await tx.pocket.findUnique({ where: { id: change.pocketId } });
  if (!pocket) return;
  await createNotification(tx, {
    userId,
    type: "POCKET_FULLY_FUNDED",
    title: "Goal fully funded 🎉",
    message: `${pocket.name} is fully funded. Consider redistributing future contributions.`,
    payload: { pocketId: pocket.id },
  });
}

// Re-export for convenience.
export { isFullyFunded };
export type { PocketStatus };
