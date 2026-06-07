import { PrismaClient } from "@prisma/client";
import {
  DEMO_USER_EMAIL,
  MAIN_ACCOUNT_NAME,
  getMockStartingBalanceCents,
} from "../src/config/mockBank";

const prisma = new PrismaClient();

/** Whole dollars -> integer cents (seed values are all whole dollars). */
const usd = (dollars: number) => dollars * 100;

async function reset() {
  await prisma.moneyMovement.deleteMany();
  await prisma.moneyMovementBatch.deleteMany();
  await prisma.fundingRule.deleteMany();
  await prisma.fundingPlan.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.job.deleteMany();
  await prisma.pocket.deleteMany();
  await prisma.category.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await reset();

  const user = await prisma.user.create({
    data: { email: DEMO_USER_EMAIL, displayName: "Demo User" },
  });

  await prisma.account.create({
    data: {
      userId: user.id,
      name: MAIN_ACCOUNT_NAME,
      accountType: "manual_simulated",
      balanceCents: getMockStartingBalanceCents(),
      isMain: true,
    },
  });

  // Categories with their funding-plan weight (basis points) and pockets.
  const blueprint = [
    {
      name: "Needs",
      weightBp: 4000,
      pockets: [
        { name: "Rent", type: "recurring_bill", target: 1000, current: 800, weightBp: 7000 },
        { name: "Groceries", type: "monthly_budget", target: 300, current: 100, weightBp: 3000 },
      ],
    },
    {
      name: "Travel",
      weightBp: 2000,
      pockets: [
        { name: "Spain", type: "one_time_goal", target: 1200, current: 400, weightBp: 6000 },
        { name: "Italy", type: "one_time_goal", target: 800, current: 100, weightBp: 4000 },
      ],
    },
    {
      name: "Electronics",
      weightBp: 1000,
      pockets: [
        { name: "AirPods", type: "one_time_goal", target: 180, current: 50, weightBp: 3000 },
        { name: "Computer", type: "one_time_goal", target: 1500, current: 300, weightBp: 7000 },
      ],
    },
    {
      name: "Monthly Spending",
      weightBp: 1000,
      pockets: [
        { name: "Restaurants", type: "monthly_budget", target: 250, current: 100, weightBp: 7000 },
        { name: "Clothes", type: "monthly_budget", target: 100, current: 30, weightBp: 3000 },
      ],
    },
    {
      name: "Investments",
      weightBp: 1000,
      pockets: [
        { name: "Roth IRA", type: "investment_contribution", target: 500, current: 200, weightBp: 6000 },
        { name: "Schwab", type: "investment_contribution", target: 300, current: 50, weightBp: 4000 },
      ],
    },
  ] as const;

  const plan = await prisma.fundingPlan.create({
    data: { userId: user.id, name: "Default plan", isActive: true, mode: "percentage" },
  });

  // Free to Spend share: 100% - sum(category weights).
  const categoryWeightTotal = blueprint.reduce((s, c) => s + c.weightBp, 0);
  await prisma.fundingRule.create({
    data: {
      fundingPlanId: plan.id,
      ruleType: "free_to_spend",
      destinationType: "free_to_spend",
      basisPoints: 10_000 - categoryWeightTotal,
      stageOrder: 99,
    },
  });

  let sortOrder = 0;
  for (const cat of blueprint) {
    const category = await prisma.category.create({
      data: {
        userId: user.id,
        name: cat.name,
        sortOrder: sortOrder++,
        allocationBasisPoints: cat.weightBp,
      },
    });

    await prisma.fundingRule.create({
      data: {
        fundingPlanId: plan.id,
        ruleType: "category_percentage",
        destinationType: "category",
        destinationId: category.id,
        basisPoints: cat.weightBp,
      },
    });

    for (const p of cat.pockets) {
      const current = usd(p.current);
      const target = usd(p.target);
      const pocket = await prisma.pocket.create({
        data: {
          userId: user.id,
          categoryId: category.id,
          name: p.name,
          pocketType: p.type,
          status: current >= target ? "fully_funded" : "active",
          targetAmountCents: target,
          currentBalanceCents: current,
          allocationBasisPoints: p.weightBp,
        },
      });

      await prisma.fundingRule.create({
        data: {
          fundingPlanId: plan.id,
          ruleType: "pocket_percentage",
          destinationType: "pocket",
          destinationId: pocket.id,
          basisPoints: p.weightBp,
        },
      });
    }

    // Every category gets an auto-managed Overflow pocket (no funding rule).
    await prisma.pocket.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        name: "Overflow",
        pocketType: "overflow",
        isOverflow: true,
        status: "active",
        currentBalanceCents: 0,
      },
    });
  }

  // Recurring income sources. First pay dates are a few days out so a fresh
  // seed shows upcoming income without immediately generating back-paychecks.
  const now = new Date();
  const inDays = (n: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  await prisma.job.create({
    data: {
      userId: user.id,
      name: "Day job",
      amountCents: usd(1800),
      payFrequency: "biweekly",
      firstPayDate: inDays(5),
      autoDisperse: true,
    },
  });
  await prisma.job.create({
    data: {
      userId: user.id,
      name: "Side gig",
      amountCents: usd(600),
      payFrequency: "monthly",
      firstPayDate: inDays(12),
      autoDisperse: false,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: user.id,
      type: "USER_REGISTERED",
      message: "Demo data seeded",
    },
  });

  const counts = {
    categories: await prisma.category.count(),
    pockets: await prisma.pocket.count(),
    fundingRules: await prisma.fundingRule.count(),
    jobs: await prisma.job.count(),
  };
  console.log("Seed complete:", { user: user.email, ...counts });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
