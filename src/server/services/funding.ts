import { prisma } from "@/lib/prisma";
import type { Tx } from "@/lib/prisma";
import {
  type CategoryWeight,
  type FundingPlanInput,
  type ValidationResult,
  validateFundingPlan,
} from "@/domain/allocation";
import { remainingCapacityCents } from "@/domain/money";

type Db = typeof prisma | Tx;

/**
 * Build the pure-engine FundingPlanInput from the user's ACTIVE funding plan.
 * Normal `active` pockets are weighted destinations; each category's Overflow
 * pocket is recorded separately so the engine can route leftovers to it.
 * Returns null when the user has no active funding plan.
 */
export async function getActiveFundingPlanInput(
  userId: string,
  db: Db = prisma,
): Promise<FundingPlanInput | null> {
  const plan = await db.fundingPlan.findFirst({
    where: { userId, isActive: true },
    include: { rules: { where: { active: true } } },
  });
  if (!plan) return null;

  const pockets = await db.pocket.findMany({ where: { userId, status: "active" } });

  const catRules = plan.rules.filter((r) => r.destinationType === "category");
  const pocketRuleWeight = new Map(
    plan.rules
      .filter((r) => r.destinationType === "pocket" && r.destinationId)
      .map((r) => [r.destinationId as string, r.basisPoints ?? 0]),
  );
  const ftsRule = plan.rules.find((r) => r.destinationType === "free_to_spend");

  const categories: CategoryWeight[] = catRules.map((cr) => {
    const catPockets = pockets.filter((p) => p.categoryId === cr.destinationId);
    const overflow = catPockets.find((p) => p.isOverflow);
    const normal = catPockets.filter((p) => !p.isOverflow);
    return {
      id: cr.destinationId ?? "",
      weightBp: cr.basisPoints ?? 0,
      overflowPocketId: overflow?.id,
      pockets: normal.map((p) => ({
        id: p.id,
        weightBp: pocketRuleWeight.get(p.id) ?? 0,
        capacityCents: remainingCapacityCents(p.currentBalanceCents, p.targetAmountCents),
      })),
    };
  });

  return { categories, freeToSpendWeightBp: ftsRule?.basisPoints ?? 0 };
}

/**
 * Build a single category's allocation input (its pocket weights + capacities +
 * Overflow pocket), used by pocket -> category transfers. `adjust` lets the
 * caller account for money about to be released from a pocket in this category
 * (so its capacity reflects the post-release balance).
 */
export async function getCategoryAllocationInput(
  userId: string,
  categoryId: string,
  db: Db = prisma,
  adjust?: { pocketId: string; deltaCents: number },
): Promise<CategoryWeight | null> {
  const category = await db.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) return null;

  const plan = await db.fundingPlan.findFirst({
    where: { userId, isActive: true },
    include: { rules: { where: { active: true, destinationType: "pocket" } } },
  });
  const pocketRuleWeight = new Map(
    (plan?.rules ?? [])
      .filter((r) => r.destinationId)
      .map((r) => [r.destinationId as string, r.basisPoints ?? 0]),
  );

  const catPockets = await db.pocket.findMany({
    where: { userId, categoryId, status: "active" },
  });
  const overflow = catPockets.find((p) => p.isOverflow);
  const normal = catPockets.filter((p) => !p.isOverflow);

  return {
    id: categoryId,
    weightBp: category.allocationBasisPoints ?? 0,
    overflowPocketId: overflow?.id,
    pockets: normal.map((p) => {
      const effectiveCurrent =
        adjust && adjust.pocketId === p.id
          ? p.currentBalanceCents - adjust.deltaCents
          : p.currentBalanceCents;
      return {
        id: p.id,
        weightBp: pocketRuleWeight.get(p.id) ?? 0,
        capacityCents: remainingCapacityCents(effectiveCurrent, p.targetAmountCents),
      };
    }),
  };
}

export async function validateActivePlan(
  userId: string,
  db: Db = prisma,
): Promise<ValidationResult & { hasPlan: boolean }> {
  const input = await getActiveFundingPlanInput(userId, db);
  if (!input) return { hasPlan: false, valid: true, errors: [] };
  return { hasPlan: true, ...validateFundingPlan(input) };
}
