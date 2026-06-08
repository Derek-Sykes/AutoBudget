import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { JobStatus, PayFrequency, PocketStatus, PocketType } from "@/domain/types";

let counter = 0;
const uniq = () => `${Date.now()}-${counter++}`;

export async function seedUser(balanceCents = 500_000) {
  const user = await prisma.user.create({
    data: {
      email: `user-${uniq()}@test.dev`,
      displayName: "Tester",
      passwordHash: await bcrypt.hash("password123", 4),
    },
  });
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      name: "Main Account",
      accountType: "manual_simulated",
      balanceCents,
      isMain: true,
    },
  });
  return { userId: user.id, accountId: account.id };
}

export async function makeCategory(userId: string, name = "Cat", weightBp?: number) {
  return prisma.category.create({
    data: { userId, name, allocationBasisPoints: weightBp ?? null },
  });
}

export async function makePocket(
  userId: string,
  categoryId: string,
  opts: {
    name?: string;
    type?: PocketType;
    targetCents?: number | null;
    currentCents?: number;
    status?: PocketStatus;
    weightBp?: number;
    isOverflow?: boolean;
  } = {},
) {
  return prisma.pocket.create({
    data: {
      userId,
      categoryId,
      name: opts.name ?? "Pocket",
      pocketType: opts.type ?? "one_time_goal",
      isOverflow: opts.isOverflow ?? false,
      status: opts.status ?? "active",
      targetAmountCents: opts.targetCents ?? null,
      currentBalanceCents: opts.currentCents ?? 0,
      allocationBasisPoints: opts.weightBp ?? null,
    },
  });
}

/** Create a category's Overflow pocket (no target, infinite capacity). */
export async function makeOverflow(userId: string, categoryId: string) {
  return prisma.pocket.create({
    data: {
      userId,
      categoryId,
      name: "Overflow",
      pocketType: "overflow",
      isOverflow: true,
      status: "active",
      currentBalanceCents: 0,
    },
  });
}

export async function makeJob(
  userId: string,
  opts: {
    name?: string;
    amountCents?: number;
    payFrequency?: PayFrequency;
    firstPayDate: Date;
    autoDisperse?: boolean;
    status?: JobStatus;
    lastPaidDate?: Date | null;
    semiMonthlyDay1?: number | null;
    semiMonthlyDay2?: number | null;
  },
) {
  return prisma.job.create({
    data: {
      userId,
      name: opts.name ?? "Job",
      amountCents: opts.amountCents ?? 100_000,
      payFrequency: opts.payFrequency ?? "weekly",
      firstPayDate: opts.firstPayDate,
      autoDisperse: opts.autoDisperse ?? false,
      status: opts.status ?? "active",
      lastPaidDate: opts.lastPaidDate ?? null,
      semiMonthlyDay1: opts.semiMonthlyDay1 ?? null,
      semiMonthlyDay2: opts.semiMonthlyDay2 ?? null,
    },
  });
}

export interface PlanSpec {
  freeToSpendBp: number;
  categories: {
    categoryId: string;
    weightBp: number;
    pockets: { pocketId: string; weightBp: number }[];
  }[];
}

export async function makeFundingPlan(userId: string, spec: PlanSpec) {
  const plan = await prisma.fundingPlan.create({
    data: { userId, name: "Plan", isActive: true },
  });
  await prisma.fundingRule.create({
    data: {
      fundingPlanId: plan.id,
      ruleType: "free_to_spend",
      destinationType: "free_to_spend",
      basisPoints: spec.freeToSpendBp,
    },
  });
  for (const cat of spec.categories) {
    await prisma.fundingRule.create({
      data: {
        fundingPlanId: plan.id,
        ruleType: "category_percentage",
        destinationType: "category",
        destinationId: cat.categoryId,
        basisPoints: cat.weightBp,
      },
    });
    for (const p of cat.pockets) {
      await prisma.fundingRule.create({
        data: {
          fundingPlanId: plan.id,
          ruleType: "pocket_percentage",
          destinationType: "pocket",
          destinationId: p.pocketId,
          basisPoints: p.weightBp,
        },
      });
    }
  }
  return plan;
}
