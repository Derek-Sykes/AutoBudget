"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserId } from "@/server/currentUser";
import { AuthError } from "@/server/auth";
import { MoneyError, parseDollarsToCents } from "@/domain/money";
import { LedgerError } from "@/server/services/ledger";
import { setAsideToCategory, setAsideToPocket } from "@/server/services/moneyMovement";
import { addPaycheck, previewPaycheck } from "@/server/services/paycheck";
import { correctPaycheck } from "@/server/services/paycheckCorrection";
import { addPayback } from "@/server/services/payback";
import { purchasePocket, cancelPocket } from "@/server/services/purchaseCancel";
import { transfer } from "@/server/services/transfer";
import { reverseBatchById } from "@/server/services/reversal";
import {
  archiveCategory,
  createCategory,
  createPocket,
  setPocketStatus,
  updateCategory,
  updatePocket,
} from "@/server/services/catalog";
import { manualAdjust } from "@/server/services/adjustment";
import {
  clearNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/services/notifications";
import { saveFundingPlan } from "@/server/services/fundingPlanService";
import { createJob, setJobStatus, updateJob } from "@/server/services/jobs";
import { runPayrollCatchUp } from "@/server/services/payroll";
import type { PlanWeightsInput } from "@/domain/fundingPlan";
import type { JobStatus, PayFrequency, PocketType, RestoreMode } from "@/domain/types";

export type ActionState = { ok: boolean; error?: string };

function fail(e: unknown): ActionState {
  if (e instanceof AuthError) return { ok: false, error: e.message };
  if (e instanceof LedgerError || e instanceof MoneyError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.errors[0]?.message ?? "Invalid input." };
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

function refresh() {
  // Revalidate every route so all balances/cards update after a money move.
  revalidatePath("/", "layout");
}

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();

// ----------------------------- Deposits ------------------------------------

export async function previewPaycheckAction(amount: string, autoDisperse: boolean) {
  try {
    const userId = await getCurrentUserId();
    const cents = parseDollarsToCents(amount);
    const preview = await previewPaycheck(userId, cents, autoDisperse);
    return { ok: true as const, preview };
  } catch (e) {
    return { ok: false as const, error: fail(e).error };
  }
}

export async function addPaycheckAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    const amountCents = parseDollarsToCents(str(fd, "amount"));
    await addPaycheck({
      userId,
      amountCents,
      autoDisperse: str(fd, "autoDisperse") === "true",
      note: str(fd, "note") || undefined,
      idempotencyKey: str(fd, "idempotencyKey") || undefined,
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addPaybackAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    const amountCents = parseDollarsToCents(str(fd, "amount"));
    const restoreMode = str(fd, "restoreMode") as RestoreMode;

    await addPayback({
      userId,
      amountCents,
      transactionType: (str(fd, "transactionType") as "payback" | "refund") || "payback",
      restoreMode,
      linkedBatchId: str(fd, "linkedBatchId") || undefined,
      manualDestinationType:
        (str(fd, "manualDestinationType") as "pocket" | "free_to_spend") || undefined,
      manualDestinationId: str(fd, "manualDestinationId") || undefined,
      note: str(fd, "note") || undefined,
      idempotencyKey: str(fd, "idempotencyKey") || undefined,
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --------------------------- Pocket money ----------------------------------

export async function setAsideAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await setAsideToPocket({
      userId,
      pocketId: str(fd, "pocketId"),
      amountCents: parseDollarsToCents(str(fd, "amount")),
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setAsideToCategoryAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await setAsideToCategory({
      userId,
      categoryId: str(fd, "categoryId"),
      amountCents: parseDollarsToCents(str(fd, "amount")),
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await purchasePocket({
      userId,
      pocketId: str(fd, "pocketId"),
      purchaseAmountCents: parseDollarsToCents(str(fd, "amount")),
      note: str(fd, "note") || undefined,
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await cancelPocket({ userId, pocketId: str(fd, "pocketId") });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function transferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    const dest = str(fd, "destination"); // "free_to_spend" | "pocket:<id>" | "category:<id>"
    const amountCents = parseDollarsToCents(str(fd, "amount"));
    let destinationType: "pocket" | "category" | "free_to_spend";
    let destinationId: string | undefined;
    if (dest === "free_to_spend") {
      destinationType = "free_to_spend";
    } else if (dest.startsWith("pocket:")) {
      destinationType = "pocket";
      destinationId = dest.slice("pocket:".length);
    } else if (dest.startsWith("category:")) {
      destinationType = "category";
      destinationId = dest.slice("category:".length);
    } else {
      return { ok: false, error: "Choose a destination." };
    }
    await transfer({
      userId,
      sourcePocketId: str(fd, "pocketId"),
      destinationType,
      destinationId,
      amountCents,
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reverseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await reverseBatchById({ userId, batchId: str(fd, "batchId") });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function correctPaycheckAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await correctPaycheck({
      userId,
      batchId: str(fd, "batchId"),
      correctedAmountCents: parseDollarsToCents(str(fd, "correctedAmount")),
      updateFutureJobAmount: str(fd, "updateFutureJobAmount") === "on",
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --------------------------- Catalog (CRUD) --------------------------------

export async function createCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await createCategory({
      userId,
      name: str(fd, "name"),
      description: str(fd, "description") || undefined,
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveFundingPlanAction(input: PlanWeightsInput): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await saveFundingPlan(userId, input);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createPocketAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    const targetRaw = str(fd, "target");
    await createPocket({
      userId,
      categoryId: str(fd, "categoryId"),
      name: str(fd, "name"),
      pocketType: (str(fd, "pocketType") as PocketType) || "one_time_goal",
      targetAmountCents: targetRaw ? parseDollarsToCents(targetRaw) : null,
      status: str(fd, "status") === "draft" ? "draft" : "active",
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

function parseDate(fd: FormData, key: string): Date | null {
  const v = str(fd, key);
  return v ? new Date(v) : null;
}

export async function updatePocketAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    const targetRaw = str(fd, "target");
    await updatePocket({
      userId,
      pocketId: str(fd, "pocketId"),
      name: str(fd, "name"),
      targetAmountCents: targetRaw ? parseDollarsToCents(targetRaw) : null,
      targetBuyDate: parseDate(fd, "targetBuyDate"),
      lockUntilDate: parseDate(fd, "lockUntilDate"),
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPocketStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await setPocketStatus({
      userId,
      pocketId: str(fd, "pocketId"),
      status: str(fd, "status") as "active" | "paused" | "archived",
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await updateCategory({
      userId,
      categoryId: str(fd, "categoryId"),
      name: str(fd, "name"),
      description: str(fd, "description"),
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function archiveCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await archiveCategory({ userId, categoryId: str(fd, "categoryId") });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function manualAdjustAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await manualAdjust({
      userId,
      direction: str(fd, "direction") === "decrease" ? "decrease" : "increase",
      amountCents: parseDollarsToCents(str(fd, "amount")),
      note: str(fd, "note"),
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------- Jobs --------------------------------------

const intOrNull = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
};

function jobInputFrom(fd: FormData) {
  return {
    name: str(fd, "name"),
    amountCents: parseDollarsToCents(str(fd, "amount")),
    payFrequency: str(fd, "payFrequency") as PayFrequency,
    firstPayDate: parseDate(fd, "firstPayDate") ?? new Date(NaN),
    autoDisperse: str(fd, "autoDisperse") === "on",
    semiMonthlyDay1: intOrNull(str(fd, "semiMonthlyDay1")),
    semiMonthlyDay2: intOrNull(str(fd, "semiMonthlyDay2")),
  };
}

export async function createJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await createJob({ userId, ...jobInputFrom(fd) });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await updateJob({ userId, jobId: str(fd, "jobId"), ...jobInputFrom(fd) });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setJobStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await setJobStatus({ userId, jobId: str(fd, "jobId"), status: str(fd, "status") as JobStatus });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function runCatchUpAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  try {
    const userId = await getCurrentUserId();
    await runPayrollCatchUp(userId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Notification actions are used directly as <form action={...}> (no state).
export async function markNotificationReadAction(fd: FormData): Promise<void> {
  const userId = await getCurrentUserId();
  await markNotificationRead(userId, str(fd, "id"));
  refresh();
}

export async function markAllNotificationsReadAction(_fd: FormData): Promise<void> {
  const userId = await getCurrentUserId();
  await markAllNotificationsRead(userId);
  refresh();
}

export async function clearNotificationAction(fd: FormData): Promise<void> {
  const userId = await getCurrentUserId();
  await clearNotification(userId, str(fd, "id"));
  refresh();
}
