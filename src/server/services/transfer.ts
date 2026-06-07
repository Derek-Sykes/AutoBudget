import { prisma } from "@/lib/prisma";
import { assertPositiveCents, formatCents } from "@/domain/money";
import { allocateWithinCategory } from "@/domain/allocation";
import { getMainAccount } from "./balanceService";
import { getCategoryAllocationInput } from "./funding";
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

const MOVABLE_SOURCE_STATUSES = ["active", "paused", "fully_funded"];

export interface TransferInput {
  userId: string;
  sourcePocketId: string;
  destinationType: "pocket" | "category" | "free_to_spend";
  destinationId?: string;
  amountCents: number;
  note?: string;
}

/**
 * Move set-aside money out of a pocket. The Main Account balance never changes.
 *  - to another pocket: a straight pocket-to-pocket move
 *  - to Free to Spend: releases the money (pocket shrinks, Free to Spend grows)
 *  - to a category: auto-distributes across that category's pockets exactly like
 *    a paycheck would (remainder + capped overflow land in its Overflow pocket)
 */
export async function transfer(input: TransferInput) {
  assertPositiveCents(input.amountCents);

  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const source = await tx.pocket.findFirst({
      where: { id: input.sourcePocketId, userId: input.userId },
    });
    if (!source) throw new LedgerError("Source pocket not found.");
    if (!MOVABLE_SOURCE_STATUSES.includes(source.status)) {
      throw new LedgerError("You can't move money out of this pocket.");
    }
    if (source.currentBalanceCents < input.amountCents) {
      throw new LedgerError(`"${source.name}" only holds ${formatCents(source.currentBalanceCents)}.`);
    }

    const releaseDestType =
      input.destinationType === "free_to_spend"
        ? "free_to_spend"
        : input.destinationType === "pocket"
          ? "pocket"
          : "category_unallocated";
    const movements: MovementSpec[] = [
      {
        movementType: "RELEASE_FROM_POCKET",
        amountCents: input.amountCents,
        sourceType: "pocket",
        sourceId: source.id,
        destinationType: releaseDestType,
        destinationId: input.destinationType === "free_to_spend" ? null : input.destinationId,
      },
    ];
    const touchedPocketIds = new Set<string>([source.id]);
    let summary: string;

    if (input.destinationType === "free_to_spend") {
      summary = `Released ${formatCents(input.amountCents)} from ${source.name} to Free to Spend`;
    } else if (input.destinationType === "pocket") {
      const dest = await tx.pocket.findFirst({
        where: { id: input.destinationId, userId: input.userId },
      });
      if (!dest) throw new LedgerError("Destination pocket not found.");
      if (dest.id === source.id) throw new LedgerError("Choose a different destination.");
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
        sourceType: "pocket",
        sourceId: source.id,
        destinationType: "pocket",
        destinationId: dest.id,
      });
      touchedPocketIds.add(dest.id);
      summary = `Transferred ${formatCents(input.amountCents)} from ${source.name} to ${dest.name}`;
    } else {
      // destinationType === "category": auto-distribute like a paycheck.
      const catInput = await getCategoryAllocationInput(input.userId, input.destinationId ?? "", tx, {
        pocketId: source.id,
        deltaCents: input.amountCents,
      });
      if (!catInput) throw new LedgerError("Destination category not found.");
      const { allocations } = allocateWithinCategory(input.amountCents, catInput);
      for (const a of allocations) {
        movements.push({
          movementType: "SET_ASIDE_TO_POCKET",
          amountCents: a.amountCents,
          sourceType: "category_unallocated",
          sourceId: input.destinationId,
          destinationType: "pocket",
          destinationId: a.pocketId,
        });
        touchedPocketIds.add(a.pocketId);
      }
      summary = `Distributed ${formatCents(input.amountCents)} from ${source.name} across the category`;
    }

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "MANUAL_REALLOCATION",
      note: input.note,
      movements,
    });

    const statusChanges: StatusChange[] = [];
    for (const pocketId of touchedPocketIds) {
      const change = await recomputeFullyFunded(tx, pocketId);
      if (change) statusChanges.push(change);
    }
    if (statusChanges.length) await recordStatusChanges(tx, batch.id, statusChanges);

    await logActivity(tx, {
      userId: input.userId,
      type: "MANUAL_REALLOCATION",
      message: summary,
      amountCents: input.amountCents,
      pocketId: source.id,
      batchId: batch.id,
    });

    for (const change of statusChanges) await notifyIfFullyFunded(tx, input.userId, change);

    return { batchId: batch.id };
  });
}
