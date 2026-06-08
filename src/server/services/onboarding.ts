import type { Tx } from "@/lib/prisma";
import { getMockStartingBalanceCents, MAIN_ACCOUNT_NAME } from "@/config/mockBank";
import { OVERFLOW_POCKET_NAME } from "@/domain/types";

const STARTER_CATEGORIES = ["Needs", "Goals", "Fun"];

export async function createDefaultUserData(
  tx: Tx,
  userId: string,
  options: { startingBalanceCents?: number; categories?: string[] } = {},
) {
  const existingAccount = await tx.account.findFirst({ where: { userId, isMain: true } });
  if (!existingAccount) {
    await tx.account.create({
      data: {
        userId,
        name: MAIN_ACCOUNT_NAME,
        accountType: "manual_simulated",
        balanceCents: options.startingBalanceCents ?? getMockStartingBalanceCents(),
        isMain: true,
      },
    });
  }

  const categoryNames = options.categories ?? STARTER_CATEGORIES;
  for (const [index, name] of categoryNames.entries()) {
    const category = await tx.category.create({
      data: {
        userId,
        name,
        sortOrder: index,
        allocationBasisPoints: 0,
      },
    });

    await tx.pocket.create({
      data: {
        userId,
        categoryId: category.id,
        name: OVERFLOW_POCKET_NAME,
        pocketType: "overflow",
        isOverflow: true,
        status: "active",
        targetAmountCents: null,
        currentBalanceCents: 0,
      },
    });
  }

  const plan = await tx.fundingPlan.create({
    data: { userId, name: "Default plan", isActive: true, mode: "percentage" },
  });

  await tx.fundingRule.create({
    data: {
      fundingPlanId: plan.id,
      ruleType: "free_to_spend",
      destinationType: "free_to_spend",
      basisPoints: 10_000,
      stageOrder: 99,
    },
  });

  await tx.activityLog.create({
    data: {
      userId,
      type: "USER_REGISTERED",
      message: "Account created",
    },
  });
}
