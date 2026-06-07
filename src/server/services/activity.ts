import type { Tx } from "@/lib/prisma";
import type { NotificationType } from "@/domain/types";

export interface ActivityInput {
  userId: string;
  type: string;
  message?: string;
  amountCents?: number;
  accountId?: string;
  categoryId?: string;
  pocketId?: string;
  transactionId?: string;
  batchId?: string;
  metadata?: Record<string, unknown>;
}

/** Write a human-readable activity log row (within a transaction). */
export async function logActivity(tx: Tx, input: ActivityInput) {
  return tx.activityLog.create({
    data: {
      userId: input.userId,
      type: input.type,
      message: input.message ?? null,
      amountCents: input.amountCents ?? null,
      accountId: input.accountId ?? null,
      categoryId: input.categoryId ?? null,
      pocketId: input.pocketId ?? null,
      transactionId: input.transactionId ?? null,
      batchId: input.batchId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

export async function createNotification(tx: Tx, input: NotificationInput) {
  return tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    },
  });
}
