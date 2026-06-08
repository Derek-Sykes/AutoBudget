import { prisma } from "@/lib/prisma";
import { getDashboardBalances } from "./services/balanceService";
import { SET_ASIDE_STATUSES, type JobStatus, type PayFrequency, type PocketStatus } from "@/domain/types";
import {
  estimatedMonthlyIncomeCents,
  nextPayDate,
  type JobSchedule,
} from "@/domain/payroll";

export interface PocketView {
  id: string;
  name: string;
  status: PocketStatus;
  pocketType: string;
  isOverflow: boolean;
  currentBalanceCents: number;
  targetAmountCents: number | null;
  targetBuyDate: string | null;
  lockUntilDate: string | null;
}

const toDateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface CategoryView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  setAsideCents: number;
  targetTotalCents: number;
  activeCount: number;
  fullyFundedCount: number;
  pockets: PocketView[];
}

function toCategoryView(category: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  pockets: PocketView[];
}): CategoryView {
  const live = category.pockets.filter((p) => SET_ASIDE_STATUSES.includes(p.status));
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    status: category.status,
    // Overflow balances count toward Set Aside, but not toward pocket counts.
    setAsideCents: live.reduce((s, p) => s + p.currentBalanceCents, 0),
    targetTotalCents: live.reduce((s, p) => s + (p.targetAmountCents ?? 0), 0),
    activeCount: category.pockets.filter((p) => p.status === "active" && !p.isOverflow).length,
    fullyFundedCount: category.pockets.filter(
      (p) => p.status === "fully_funded" && !p.isOverflow,
    ).length,
    pockets: category.pockets,
  };
}

export async function getDashboardData(userId: string) {
  const balances = await getDashboardBalances(userId);
  const categories = await prisma.category.findMany({
    where: { userId, status: "active" },
    orderBy: { sortOrder: "asc" },
    include: {
      pockets: {
        where: { status: { notIn: ["archived"] } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return {
    balances,
    categories: categories.map((c) =>
      toCategoryView({
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        pockets: c.pockets.map(mapPocket),
      }),
    ),
  };
}

export async function getCategoryDetail(userId: string, categoryId: string) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    include: { pockets: { orderBy: { createdAt: "asc" } } },
  });
  if (!category) return null;
  const balances = await getDashboardBalances(userId);
  return {
    balances,
    category: toCategoryView({
      id: category.id,
      name: category.name,
      description: category.description,
      status: category.status,
      pockets: category.pockets.map(mapPocket),
    }),
  };
}

function mapPocket(p: {
  id: string;
  name: string;
  status: string;
  pocketType: string;
  isOverflow: boolean;
  currentBalanceCents: number;
  targetAmountCents: number | null;
  targetBuyDate: Date | null;
  lockUntilDate: Date | null;
}): PocketView {
  return {
    id: p.id,
    name: p.name,
    status: p.status as PocketStatus,
    pocketType: p.pocketType,
    isOverflow: p.isOverflow,
    currentBalanceCents: p.currentBalanceCents,
    targetAmountCents: p.targetAmountCents,
    targetBuyDate: toDateInput(p.targetBuyDate),
    lockUntilDate: toDateInput(p.lockUntilDate),
  };
}

/** Active, non-overflow pockets the user can set money aside into (for menus). */
export async function getActivePockets(userId: string) {
  return prisma.pocket.findMany({
    where: { userId, status: "active", isOverflow: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, categoryId: true },
  });
}

export interface TransferTargets {
  pockets: { id: string; name: string; categoryName: string; isOverflow: boolean }[];
  categories: { id: string; name: string }[];
}

/** Destinations for a pocket transfer: every active pocket and every category. */
export async function getTransferTargets(userId: string): Promise<TransferTargets> {
  const categories = await prisma.category.findMany({
    where: { userId, status: "active" },
    orderBy: { sortOrder: "asc" },
    include: { pockets: { where: { status: "active" }, orderBy: { createdAt: "asc" } } },
  });
  const pockets = categories.flatMap((c) =>
    c.pockets.map((p) => ({
      id: p.id,
      name: p.name,
      categoryName: c.name,
      isOverflow: p.isOverflow,
    })),
  );
  return {
    pockets,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  };
}

/** Recent purchases, so a payback/refund can be linked to one. */
export async function getRecentPurchases(userId: string) {
  const batches = await prisma.moneyMovementBatch.findMany({
    where: { userId, batchType: "PURCHASE", status: "applied" },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { movements: true },
  });
  return batches.map((b) => {
    const amount = b.movements
      .filter((m) => m.movementType === "MAIN_ACCOUNT_DECREASE")
      .reduce((s, m) => s + m.amountCents, 0);
    return { id: b.id, note: b.note, amountCents: amount, createdAt: b.createdAt };
  });
}

// ------------------------------- Jobs --------------------------------------

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface JobView {
  id: string;
  name: string;
  amountCents: number;
  payFrequency: PayFrequency;
  status: JobStatus;
  autoDisperse: boolean;
  firstPayDate: string;
  semiMonthlyDay1: number | null;
  semiMonthlyDay2: number | null;
  lastPaidDate: string | null;
  nextPayDate: string | null;
  monthlyIncomeCents: number;
}

function scheduleFor(job: {
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

export async function getJobsView(userId: string, now: Date = new Date()): Promise<JobView[]> {
  const jobs = await prisma.job.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const rank: Record<string, number> = { active: 0, paused: 1, archived: 2 };
  return jobs
    .map((job) => ({
      id: job.id,
      name: job.name,
      amountCents: job.amountCents,
      payFrequency: job.payFrequency as PayFrequency,
      status: job.status as JobStatus,
      autoDisperse: job.autoDisperse,
      firstPayDate: isoDay(job.firstPayDate)!,
      semiMonthlyDay1: job.semiMonthlyDay1,
      semiMonthlyDay2: job.semiMonthlyDay2,
      lastPaidDate: isoDay(job.lastPaidDate),
      nextPayDate: job.status === "active" ? isoDay(nextPayDate(scheduleFor(job), now)) : null,
      monthlyIncomeCents: estimatedMonthlyIncomeCents(job.payFrequency as PayFrequency, job.amountCents),
    }))
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.nextPayDate ?? "").localeCompare(b.nextPayDate ?? ""));
}

export interface IncomeSummary {
  activeJobCount: number;
  monthlyIncomeCents: number;
  nextPaycheck: { jobName: string; dateISO: string; amountCents: number } | null;
}

export async function getIncomeSummary(userId: string, now: Date = new Date()): Promise<IncomeSummary> {
  const jobs = await prisma.job.findMany({ where: { userId, status: "active" } });
  let monthlyIncomeCents = 0;
  let next: { jobName: string; dateISO: string; amountCents: number } | null = null;
  for (const job of jobs) {
    monthlyIncomeCents += estimatedMonthlyIncomeCents(job.payFrequency as PayFrequency, job.amountCents);
    const dateISO = nextPayDate(scheduleFor(job), now).toISOString().slice(0, 10);
    if (!next || dateISO < next.dateISO) {
      next = { jobName: job.name, dateISO, amountCents: job.amountCents };
    }
  }
  return { activeJobCount: jobs.length, monthlyIncomeCents, nextPaycheck: next };
}

export async function getActivityFeed(userId: string) {
  const [logs, notifications, batches, paycheckBatches, correctionBatches] = await Promise.all([
    prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.moneyMovementBatch.findMany({
      where: {
        userId,
        status: "applied",
        batchType: { notIn: ["REVERSAL"] },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.moneyMovementBatch.findMany({
      where: { userId, batchType: "PAYCHECK_DEPOSIT", status: "applied" },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { movements: true },
    }),
    prisma.moneyMovementBatch.findMany({
      where: { userId, batchType: "PAYCHECK_CORRECTION", status: "applied" },
      include: { movements: true },
    }),
  ]);

  const correctionDeltaByPaycheck = new Map<string, number>();
  for (const batch of correctionBatches) {
    let correctsBatchId: string | null = null;
    if (batch.metadataJson) {
      try {
        const metadata = JSON.parse(batch.metadataJson) as { correctsBatchId?: string };
        correctsBatchId = metadata.correctsBatchId ?? null;
      } catch {
        correctsBatchId = null;
      }
    }
    if (!correctsBatchId) continue;
    const delta = batch.movements.reduce((sum, movement) => {
      if (movement.movementType === "MAIN_ACCOUNT_INCREASE") return sum + movement.amountCents;
      if (movement.movementType === "MAIN_ACCOUNT_DECREASE") return sum - movement.amountCents;
      return sum;
    }, 0);
    correctionDeltaByPaycheck.set(
      correctsBatchId,
      (correctionDeltaByPaycheck.get(correctsBatchId) ?? 0) + delta,
    );
  }

  const correctablePaychecks = paycheckBatches.map((batch) => {
    const originalAmountCents = batch.movements
      .filter((movement) => movement.movementType === "MAIN_ACCOUNT_INCREASE")
      .reduce((sum, movement) => sum + movement.amountCents, 0);
    return {
      id: batch.id,
      note: batch.note,
      createdAt: batch.createdAt,
      originalAmountCents,
      currentAmountCents: originalAmountCents + (correctionDeltaByPaycheck.get(batch.id) ?? 0),
      isPayrollGenerated: batch.idempotencyKey?.startsWith("payroll:") ?? false,
    };
  });

  return { logs, notifications, reversibleBatches: batches, correctablePaychecks };
}
