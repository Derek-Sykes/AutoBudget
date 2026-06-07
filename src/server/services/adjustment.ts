import { prisma } from "@/lib/prisma";
import { assertPositiveCents, formatCents } from "@/domain/money";
import { getDashboardBalances, getMainAccount } from "./balanceService";
import { applyBatch, LedgerError, type MovementSpec } from "./ledger";
import { logActivity } from "./activity";

export interface ManualAdjustInput {
  userId: string;
  direction: "increase" | "decrease";
  amountCents: number;
  /** Required: corrections must be explained. */
  note: string;
}

/**
 * Manual adjustment / correction to the simulated Main Account balance. This is
 * NOT income and never auto-disperses. It requires a note and creates a normal
 * reversible ledger batch (it never edits historical rows). A decrease can't
 * exceed Free to Spend, so it can never push committed pocket money or Free to
 * Spend negative.
 */
export async function manualAdjust(input: ManualAdjustInput) {
  assertPositiveCents(input.amountCents);
  const note = input.note?.trim();
  if (!note) throw new LedgerError("A note is required for a manual adjustment.");

  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);

    if (input.direction === "decrease") {
      const { freeToSpendCents } = await getDashboardBalances(input.userId, tx);
      if (input.amountCents > freeToSpendCents) {
        throw new LedgerError(
          `You can only reduce by up to your Free to Spend (${formatCents(freeToSpendCents)}). Move money out of pockets first.`,
        );
      }
    }

    const transaction = await tx.transaction.create({
      data: {
        userId: input.userId,
        accountId: account.id,
        amountCents: input.amountCents,
        transactionType: "manual_adjustment",
        description: note,
      },
    });

    const movements: MovementSpec[] =
      input.direction === "increase"
        ? [
            {
              movementType: "MAIN_ACCOUNT_INCREASE",
              amountCents: input.amountCents,
              destinationType: "main_account",
              destinationId: account.id,
            },
          ]
        : [
            {
              movementType: "MAIN_ACCOUNT_DECREASE",
              amountCents: input.amountCents,
              sourceType: "main_account",
              sourceId: account.id,
              destinationType: "external",
            },
          ];

    const batch = await applyBatch(tx, {
      userId: input.userId,
      mainAccountId: account.id,
      batchType: "MANUAL_ADJUSTMENT",
      transactionId: transaction.id,
      note,
      movements,
    });

    const sign = input.direction === "increase" ? "+" : "−";
    await logActivity(tx, {
      userId: input.userId,
      type: "ACCOUNT_BALANCE_ADJUSTED",
      message: `Manual adjustment ${sign}${formatCents(input.amountCents)}: ${note}`,
      amountCents: input.amountCents,
      accountId: account.id,
      transactionId: transaction.id,
      batchId: batch.id,
    });

    return { batchId: batch.id };
  });
}
