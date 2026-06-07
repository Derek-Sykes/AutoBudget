import { prisma } from "@/lib/prisma";
import { getMainAccount } from "./balanceService";
import { reverseBatch } from "./ledger";
import { logActivity } from "./activity";

export interface ReverseInput {
  userId: string;
  batchId: string;
}

/**
 * Safely reverse a clean, applied batch. Blocks double reversal and any reversal
 * that would drive a balance negative (handled inside reverseBatch).
 */
export async function reverseBatchById(input: ReverseInput) {
  return prisma.$transaction(async (tx) => {
    const account = await getMainAccount(input.userId, tx);
    const result = await reverseBatch(tx, input.userId, account.id, input.batchId);

    await logActivity(tx, {
      userId: input.userId,
      type: "MONEY_MOVEMENT_REVERSED",
      message: "Reversed a previous action",
      batchId: result.reversalBatchId,
      metadata: { originalBatchId: input.batchId },
    });

    return result;
  });
}
