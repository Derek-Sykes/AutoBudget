import { prisma } from "@/lib/prisma";
import { LedgerError } from "./ledger";
import { logActivity } from "./activity";
import { JOB_STATUSES, PAY_FREQUENCIES, type JobStatus, type PayFrequency } from "@/domain/types";

export interface JobInput {
  userId: string;
  name: string;
  amountCents: number;
  payFrequency: PayFrequency;
  firstPayDate: Date;
  autoDisperse: boolean;
  semiMonthlyDay1?: number | null;
  semiMonthlyDay2?: number | null;
}

interface NormalizedJob {
  name: string;
  amountCents: number;
  payFrequency: PayFrequency;
  firstPayDate: Date;
  autoDisperse: boolean;
  semiMonthlyDay1: number | null;
  semiMonthlyDay2: number | null;
}

function validate(input: JobInput): NormalizedJob {
  const name = input.name?.trim();
  if (!name) throw new LedgerError("Job name is required.");

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new LedgerError("Paycheck amount must be greater than zero.");
  }
  if (!PAY_FREQUENCIES.includes(input.payFrequency)) {
    throw new LedgerError("Choose a valid pay schedule.");
  }
  if (!(input.firstPayDate instanceof Date) || Number.isNaN(input.firstPayDate.getTime())) {
    throw new LedgerError("A valid first pay date is required.");
  }

  let day1: number | null = null;
  let day2: number | null = null;
  if (input.payFrequency === "semimonthly") {
    day1 = input.semiMonthlyDay1 ?? 1;
    day2 = input.semiMonthlyDay2 ?? 15;
    const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 31;
    if (!ok(day1) || !ok(day2) || day1 === day2) {
      throw new LedgerError("Semi-monthly pay needs two different days between 1 and 31.");
    }
  }

  return {
    name,
    amountCents: input.amountCents,
    payFrequency: input.payFrequency,
    firstPayDate: input.firstPayDate,
    autoDisperse: input.autoDisperse,
    semiMonthlyDay1: day1,
    semiMonthlyDay2: day2,
  };
}

export async function createJob(input: JobInput) {
  const data = validate(input);
  const job = await prisma.job.create({
    data: { userId: input.userId, status: "active", lastPaidDate: null, ...data },
  });
  await prisma.$transaction((tx) =>
    logActivity(tx, {
      userId: input.userId,
      type: "JOB_CREATED",
      message: `Added income source: ${data.name}`,
    }),
  );
  return job;
}

export interface UpdateJobInput extends JobInput {
  jobId: string;
}

/**
 * Edit a job. Does NOT touch lastPaidDate or status, so changing the schedule or
 * amount only affects FUTURE paychecks — past generated paychecks are untouched
 * and never duplicated (their idempotency keys already exist).
 */
export async function updateJob(input: UpdateJobInput) {
  const data = validate(input);
  const existing = await prisma.job.findFirst({ where: { id: input.jobId, userId: input.userId } });
  if (!existing) throw new LedgerError("Job not found.");

  const job = await prisma.job.update({ where: { id: existing.id }, data });
  await prisma.$transaction((tx) =>
    logActivity(tx, {
      userId: input.userId,
      type: "JOB_UPDATED",
      message: `Updated income source: ${data.name}`,
    }),
  );
  return job;
}

export async function setJobStatus(input: { userId: string; jobId: string; status: JobStatus }) {
  if (!JOB_STATUSES.includes(input.status)) throw new LedgerError("Invalid job status.");
  const existing = await prisma.job.findFirst({ where: { id: input.jobId, userId: input.userId } });
  if (!existing) throw new LedgerError("Job not found.");

  const job = await prisma.job.update({
    where: { id: existing.id },
    data: { status: input.status },
  });
  await prisma.$transaction((tx) =>
    logActivity(tx, {
      userId: input.userId,
      type: "JOB_STATUS_CHANGED",
      message: `${existing.name} → ${input.status}`,
    }),
  );
  return job;
}
