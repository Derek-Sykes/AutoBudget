import { prisma } from "@/lib/prisma";
import { addPaycheck } from "./paycheck";
import { duePayDates, payDateKey, type JobSchedule } from "@/domain/payroll";
import type { PayFrequency } from "@/domain/types";

function scheduleOf(job: {
  payFrequency: string;
  firstPayDate: Date;
  semiMonthlyDay1: number | null;
  semiMonthlyDay2: number | null;
}): JobSchedule {
  return {
    payFrequency: job.payFrequency as PayFrequency,
    firstPayDate: job.firstPayDate,
    semiMonthlyDay1: job.semiMonthlyDay1,
    semiMonthlyDay2: job.semiMonthlyDay2,
  };
}

/** True for a Prisma unique-constraint violation (idempotency-key race). */
function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002");
}

export interface CatchUpResult {
  generated: number;
}

/**
 * Deterministic payroll catch-up. For every ACTIVE job, generate one paycheck
 * per pay date that has come due since lastPaidDate — using the existing
 * paycheck flow (ledger, allocation, overflow, notifications, activity log).
 * Idempotent: each paycheck uses key `payroll:<jobId>:<YYYY-MM-DD>`, so running
 * this repeatedly (refresh, multiple tabs, twice) never creates duplicate money.
 * Paused and archived jobs are skipped.
 */
export async function runPayrollCatchUp(userId: string, now: Date = new Date()): Promise<CatchUpResult> {
  const jobs = await prisma.job.findMany({ where: { userId, status: "active" } });
  let generated = 0;

  for (const job of jobs) {
    const dates = duePayDates(scheduleOf(job), job.lastPaidDate, now);
    if (dates.length === 0) continue;

    let latest = job.lastPaidDate;
    for (const payDate of dates) {
      try {
        const res = await addPaycheck({
          userId,
          amountCents: job.amountCents,
          autoDisperse: job.autoDisperse,
          note: `${job.name} paycheck`,
          idempotencyKey: `payroll:${job.id}:${payDateKey(payDate)}`,
        });
        if (!res.idempotentReplay) generated += 1;
      } catch (e) {
        // A concurrent catch-up already created this exact paycheck — safe to skip.
        if (!isUniqueViolation(e)) throw e;
      }
      latest = payDate;
    }

    await prisma.job.update({ where: { id: job.id }, data: { lastPaidDate: latest } });
  }

  return { generated };
}

/**
 * Run catch-up but never let a payroll error break page rendering. Call this at
 * the start of money-related page loads (it's idempotent and cheap when nothing
 * is due).
 */
export async function ensurePayrollCurrent(userId: string): Promise<void> {
  try {
    await runPayrollCatchUp(userId);
  } catch (e) {
    console.error("Payroll catch-up failed:", e);
  }
}
