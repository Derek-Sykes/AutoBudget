import { prisma } from "@/lib/prisma";
import { LedgerError } from "./ledger";
import { logActivity } from "./activity";
import {
  distributeEvenlyBp,
  validatePlanWeights,
  type PlanWeightsInput,
} from "@/domain/fundingPlan";

export interface EditorPocket {
  pocketId: string;
  name: string;
  weightBp: number;
}
export interface EditorCategory {
  categoryId: string;
  name: string;
  weightBp: number;
  pockets: EditorPocket[];
}
export interface FundingPlanEditorData {
  freeToSpendBp: number;
  categories: EditorCategory[];
}

/**
 * Build the editor's initial state from the user's ACTIVE categories and their
 * ACTIVE pockets, pre-filling weights from the current active plan's rules and
 * defaulting anything without a rule (e.g. newly created pockets) to 0%.
 */
export async function getFundingPlanEditorData(userId: string): Promise<FundingPlanEditorData> {
  const [categories, plan] = await Promise.all([
    prisma.category.findMany({
      where: { userId, status: "active" },
      orderBy: { sortOrder: "asc" },
      include: {
        pockets: {
          where: { status: "active", isOverflow: false },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.fundingPlan.findFirst({
      where: { userId, isActive: true },
      include: { rules: true },
    }),
  ]);

  const rules = plan?.rules ?? [];
  const weightFor = (destinationType: string, destinationId?: string) =>
    rules.find(
      (r) =>
        r.destinationType === destinationType &&
        (destinationId === undefined || r.destinationId === destinationId),
    )?.basisPoints ?? 0;

  return {
    freeToSpendBp: weightFor("free_to_spend"),
    categories: categories.map((c) => ({
      categoryId: c.id,
      name: c.name,
      weightBp: weightFor("category", c.id),
      pockets: c.pockets.map((p) => ({
        pocketId: p.id,
        name: p.name,
        weightBp: weightFor("pocket", p.id),
      })),
    })),
  };
}

/**
 * Persist edited funding-plan weights. Validates the totals server-side, checks
 * that every category/pocket is still an active object owned by the user
 * (rejecting stale ids), then rebuilds the active plan's rules transactionally.
 * Creates an active plan if none exists; ensures exactly one is active.
 */
export async function saveFundingPlan(userId: string, input: PlanWeightsInput) {
  // 1. Ownership / freshness: every id must be an active object of this user,
  //    and each pocket must belong to its stated category.
  const [activeCategories, activePockets, activePlan] = await Promise.all([
    prisma.category.findMany({ where: { userId, status: "active" }, select: { id: true } }),
    prisma.pocket.findMany({
      where: { userId, status: "active", isOverflow: false },
      select: { id: true, categoryId: true },
    }),
    prisma.fundingPlan.findFirst({
      where: { userId, isActive: true },
      include: { rules: { where: { active: true } } },
    }),
  ]);
  const catIds = new Set(activeCategories.map((c) => c.id));
  const pocketCat = new Map(activePockets.map((p) => [p.id, p.categoryId]));
  const previousCategoryWeight = new Map(
    (activePlan?.rules ?? [])
      .filter((rule) => rule.destinationType === "category" && rule.destinationId)
      .map((rule) => [rule.destinationId as string, rule.basisPoints ?? 0]),
  );
  const previousPocketWeight = new Map(
    (activePlan?.rules ?? [])
      .filter((rule) => rule.destinationType === "pocket" && rule.destinationId)
      .map((rule) => [rule.destinationId as string, rule.basisPoints ?? 0]),
  );

  for (const cat of input.categories) {
    if (!catIds.has(cat.categoryId)) {
      throw new LedgerError("This plan is out of date. Refresh the page and try again.");
    }
    for (const p of cat.pockets) {
      if (pocketCat.get(p.pocketId) !== cat.categoryId) {
        throw new LedgerError("This plan is out of date. Refresh the page and try again.");
      }
    }
  }

  const planInput: PlanWeightsInput = {
    freeToSpendBp: input.freeToSpendBp,
    categories: input.categories.map((cat) => {
      const becameFunded = (previousCategoryWeight.get(cat.categoryId) ?? 0) === 0 && cat.weightBp > 0;
      const submittedAllZero = cat.pockets.every((pocket) => pocket.weightBp === 0);
      const previousAllZero = cat.pockets.every(
        (pocket) => (previousPocketWeight.get(pocket.pocketId) ?? 0) === 0,
      );
      if (becameFunded && cat.pockets.length > 0 && submittedAllZero && previousAllZero) {
        const split = distributeEvenlyBp(cat.pockets.length);
        return {
          ...cat,
          pockets: cat.pockets.map((pocket, index) => ({
            ...pocket,
            weightBp: split[index],
          })),
        };
      }
      return cat;
    }),
  };

  // 2. Shape/total validation (authoritative, mirrors the client checks).
  const validation = validatePlanWeights(planInput);
  if (!validation.valid) throw new LedgerError(validation.errors.join(" "));

  // 3. Rebuild rules in one transaction.
  return prisma.$transaction(async (tx) => {
    let plan = await tx.fundingPlan.findFirst({ where: { userId, isActive: true } });
    if (!plan) {
      plan = await tx.fundingPlan.create({
        data: { userId, name: "Default plan", isActive: true, mode: "percentage" },
      });
    }
    // Guarantee a single active plan.
    await tx.fundingPlan.updateMany({
      where: { userId, NOT: { id: plan.id } },
      data: { isActive: false },
    });
    await tx.fundingRule.deleteMany({ where: { fundingPlanId: plan.id } });

    await tx.fundingRule.create({
      data: {
        fundingPlanId: plan.id,
        ruleType: "free_to_spend",
        destinationType: "free_to_spend",
        basisPoints: planInput.freeToSpendBp,
        stageOrder: 99,
      },
    });

    for (const cat of planInput.categories) {
      await tx.fundingRule.create({
        data: {
          fundingPlanId: plan.id,
          ruleType: "category_percentage",
          destinationType: "category",
          destinationId: cat.categoryId,
          basisPoints: cat.weightBp,
        },
      });
      for (const p of cat.pockets) {
        await tx.fundingRule.create({
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

    await logActivity(tx, {
      userId,
      type: "ALLOCATION_RULE_UPDATED",
      message: "Updated funding plan percentages",
    });

    return { planId: plan.id };
  });
}
