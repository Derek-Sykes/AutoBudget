import { prisma } from "@/lib/prisma";
import { assertPositiveCents, formatCents } from "@/domain/money";
import type { PocketStatus } from "@/domain/types";
import { getDashboardBalances, getMainAccount } from "./balanceService";
import { applyBatch, LedgerError, recordStatusChanges, type MovementSpec } from "./ledger";
import { createNotification, logActivity } from "./activity";

const PURCHASABLE_STATUSES = ["active", "paused", "fully_funded"];

export interface PurchaseInput {
  userId: string;
  pocketId: string;
  purchaseAmountCents: number;
  note?: string;
}

/**
 * Mark a pocket as bought. Real simulated money leaves the system: the Main
 * Account decreases by the purchase amount. Leftover set-aside is released to
 * Free to Spend; a shortfall is pulled from Free to Spend if available.
 */
export async function purchasePocket(input: PurchaseInput) {
  assertPositiveCents(input.purchaseAmountCents);

  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const pocket = await tx.pocket.findFirst({
      where: { id: input.pocketId, userId: input.userId },
    });
    if (!pocket) throw new LedgerError("Pocket not found.");
    if (pocket.isOverflow) throw new LedgerError("The Overflow pocket can't be purchased.");
    if (!PURCHASABLE_STATUSES.includes(pocket.status)) {
      throw new LedgerError("This pocket can no longer be purchased.");
    }

    const balance = pocket.currentBalanceCents;
    const amount = input.purchaseAmountCents;
    const movements: MovementSpec[] = [];

    if (amount <= balance) {
      movements.push({
        movementType: "PURCHASE_FROM_POCKET",
        amountCents: amount,
        sourceType: "pocket",
        sourceId: pocket.id,
        destinationType: "external",
      });
      const leftover = balance - amount;
      if (leftover > 0) {
        movements.push({
          movementType: "RELEASE_FROM_POCKET",
          amountCents: leftover,
          sourceType: "pocket",
          sourceId: pocket.id,
          destinationType: "free_to_spend",
        });
      }
    } else {
      const shortfall = amount - balance;
      const { freeToSpendCents } = await getDashboardBalances(input.userId, tx);
      if (shortfall > freeToSpendCents) {
        throw new LedgerError(
          `This costs ${formatCents(amount)} but the pocket has ${formatCents(balance)} and only ${formatCents(freeToSpendCents)} is free to spend.`,
        );
      }
      if (balance > 0) {
        movements.push({
          movementType: "PURCHASE_FROM_POCKET",
          amountCents: balance,
          sourceType: "pocket",
          sourceId: pocket.id,
          destinationType: "external",
        });
      }
      movements.push({
        movementType: "PURCHASE_FROM_FREE_TO_SPEND",
        amountCents: shortfall,
        sourceType: "free_to_spend",
        destinationType: "external",
      });
    }

    // The actual cash leaving the simulated account.
    movements.push({
      movementType: "MAIN_ACCOUNT_DECREASE",
      amountCents: amount,
      sourceType: "main_account",
      sourceId: account.id,
      destinationType: "external",
    });

    const transaction = await tx.transaction.create({
      data: {
        userId: input.userId,
        accountId: account.id,
        amountCents: amount,
        transactionType: "purchase",
        description: input.note ?? `Purchased ${pocket.name}`,
      },
    });

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "PURCHASE",
      transactionId: transaction.id,
      note: input.note,
      movements,
    });

    const prevStatus = pocket.status as PocketStatus;
    await tx.pocket.update({ where: { id: pocket.id }, data: { status: "purchased" } });
    await recordStatusChanges(tx, batch.id, [
      { pocketId: pocket.id, from: prevStatus, to: "purchased" },
    ]);

    await logActivity(tx, {
      userId: input.userId,
      type: "POCKET_PURCHASED",
      message: `Bought ${pocket.name} for ${formatCents(amount)}`,
      amountCents: amount,
      pocketId: pocket.id,
      categoryId: pocket.categoryId,
      transactionId: transaction.id,
      batchId: batch.id,
    });
    await createNotification(tx, {
      userId: input.userId,
      type: "PURCHASE_RECORDED",
      title: "Purchase recorded",
      message: `You marked ${pocket.name} as bought for ${formatCents(amount)}.`,
      payload: { pocketId: pocket.id },
    });

    return { batchId: batch.id, transactionId: transaction.id };
  });
}

export interface CancelInput {
  userId: string;
  pocketId: string;
  note?: string;
}

/**
 * Cancel a goal: release its set-aside balance back to Free to Spend (Main
 * Account is unchanged) and mark the pocket cancelled.
 */
export async function cancelPocket(input: CancelInput) {
  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const pocket = await tx.pocket.findFirst({
      where: { id: input.pocketId, userId: input.userId },
    });
    if (!pocket) throw new LedgerError("Pocket not found.");
    if (pocket.isOverflow) throw new LedgerError("The Overflow pocket can't be cancelled.");
    if (!PURCHASABLE_STATUSES.includes(pocket.status)) {
      throw new LedgerError("This pocket cannot be cancelled.");
    }

    const movements: MovementSpec[] = [];
    if (pocket.currentBalanceCents > 0) {
      movements.push({
        movementType: "RELEASE_FROM_POCKET",
        amountCents: pocket.currentBalanceCents,
        sourceType: "pocket",
        sourceId: pocket.id,
        destinationType: "free_to_spend",
      });
    }

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "CANCEL_GOAL",
      note: input.note,
      movements,
    });

    const prevStatus = pocket.status as PocketStatus;
    await tx.pocket.update({ where: { id: pocket.id }, data: { status: "cancelled" } });
    await recordStatusChanges(tx, batch.id, [
      { pocketId: pocket.id, from: prevStatus, to: "cancelled" },
    ]);

    await logActivity(tx, {
      userId: input.userId,
      type: "POCKET_CANCELLED",
      message: `Cancelled ${pocket.name}, released ${formatCents(pocket.currentBalanceCents)} to Free to Spend`,
      amountCents: pocket.currentBalanceCents,
      pocketId: pocket.id,
      categoryId: pocket.categoryId,
      batchId: batch.id,
    });
    await createNotification(tx, {
      userId: input.userId,
      type: "GOAL_CANCELLED",
      title: "Goal cancelled",
      message: `${pocket.name} was cancelled and its money returned to Free to Spend.`,
      payload: { pocketId: pocket.id },
    });

    return { batchId: batch.id };
  });
}
