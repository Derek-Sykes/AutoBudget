import { BASIS_POINTS_FULL } from "./money";

// ---------------------------------------------------------------------------
// Pure allocation engine for paycheck/income auto-disperse (and pocket ->
// category transfers, which reuse allocateWithinCategory).
//
// Model: incoming money is split across categories by basis-point weights (plus
// an explicit Free-to-Spend share). Within a category each NORMAL pocket gets
// its LITERAL weight share (weights need not sum to 100%), capped at remaining
// capacity. Everything a category cannot place in its normal pockets — the
// unweighted remainder, capped-pocket overflow, or the whole share when there
// are no normal pockets — flows into that category's Overflow pocket. Only the
// explicit Free-to-Spend share reaches Free to Spend. No floating-point money.
// ---------------------------------------------------------------------------

export interface PocketWeight {
  id: string;
  /** Literal weight in basis points (share of the category amount). */
  weightBp: number;
  /** Cents this pocket can still accept before hitting target; Infinity if none. */
  capacityCents: number;
}

export interface CategoryWeight {
  id: string;
  weightBp: number;
  /** The category's Overflow pocket; absorbs remainder + capped overflow. */
  overflowPocketId?: string;
  /** Normal (non-overflow) pockets only. */
  pockets: PocketWeight[];
}

export interface FundingPlanInput {
  categories: CategoryWeight[];
  /** Share routed straight to Free to Spend, in basis points. */
  freeToSpendWeightBp: number;
}

export interface PocketAllocation {
  pocketId: string;
  amountCents: number;
}

export interface AllocationResult {
  pocketAllocations: PocketAllocation[];
  freeToSpendCents: number;
  totalSetAsideCents: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface WeightedKey {
  key: string;
  weightBp: number;
}

/**
 * Split `amountCents` across weighted keys using the largest-remainder method
 * so the parts sum EXACTLY to amountCents. Deterministic: ties broken by input
 * order. If all weights are zero, splits evenly.
 */
export function splitByWeights(
  amountCents: number,
  keys: WeightedKey[],
): { key: string; amountCents: number }[] {
  if (keys.length === 0) return [];
  if (amountCents <= 0) return keys.map((k) => ({ key: k.key, amountCents: 0 }));

  let totalWeight = keys.reduce((sum, k) => sum + Math.max(0, k.weightBp), 0);
  let weights = keys.map((k) => Math.max(0, k.weightBp));
  if (totalWeight === 0) {
    weights = keys.map(() => 1);
    totalWeight = keys.length;
  }

  const exact = weights.map((w) => (amountCents * w) / totalWeight);
  const floored = exact.map((v) => Math.floor(v));
  const distributed = floored.reduce((a, b) => a + b, 0);
  let leftover = amountCents - distributed;

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));

  const result = floored.slice();
  let idx = 0;
  while (leftover > 0) {
    result[order[idx % order.length].i] += 1;
    leftover -= 1;
    idx += 1;
  }

  return keys.map((k, i) => ({ key: k.key, amountCents: result[i] }));
}

const OVERFLOW_KEY = "__overflow__";

export interface CategoryAllocation {
  allocations: PocketAllocation[];
  /** Only > 0 when the category has no Overflow pocket (legacy fallback). */
  freeLeftoverCents: number;
}

/**
 * Distribute `amountCents` within a single category. Used by paycheck
 * auto-disperse and by pocket -> category transfers. Normal pockets get their
 * literal weight share (capped at capacity); the unweighted remainder and any
 * capped overflow go to the category's Overflow pocket. The returned amounts
 * always sum to amountCents (in allocations + freeLeftoverCents).
 */
export function allocateWithinCategory(
  amountCents: number,
  category: CategoryWeight,
): CategoryAllocation {
  if (amountCents <= 0) return { allocations: [], freeLeftoverCents: 0 };

  const normal = category.pockets;
  const sumWeights = normal.reduce((s, p) => s + Math.max(0, p.weightBp), 0);
  const remainderBp = Math.max(0, BASIS_POINTS_FULL - sumWeights);

  const keys: WeightedKey[] = normal.map((p) => ({
    key: p.id,
    weightBp: Math.max(0, p.weightBp),
  }));
  if (remainderBp > 0) keys.push({ key: OVERFLOW_KEY, weightBp: remainderBp });

  const split = splitByWeights(amountCents, keys);
  const byKey = new Map(split.map((s) => [s.key, s.amountCents]));

  let overflowCents = byKey.get(OVERFLOW_KEY) ?? 0;
  const allocations: PocketAllocation[] = [];
  for (const p of normal) {
    const want = byKey.get(p.id) ?? 0;
    const take = Math.min(want, p.capacityCents);
    if (take > 0) allocations.push({ pocketId: p.id, amountCents: take });
    overflowCents += want - take; // capped excess flows to Overflow
  }

  if (category.overflowPocketId && overflowCents > 0) {
    allocations.push({ pocketId: category.overflowPocketId, amountCents: overflowCents });
    return { allocations, freeLeftoverCents: 0 };
  }
  return { allocations, freeLeftoverCents: overflowCents };
}

/** Validate an MVP percentage funding plan (Overflow captures sub-100% pockets). */
export function validateFundingPlan(plan: FundingPlanInput): ValidationResult {
  const errors: string[] = [];

  const categoryTotal =
    plan.categories.reduce((sum, c) => sum + c.weightBp, 0) + plan.freeToSpendWeightBp;
  if (categoryTotal !== BASIS_POINTS_FULL) {
    errors.push(
      `Category percentages plus Free to Spend must total 100% (got ${(categoryTotal / 100).toFixed(2)}%).`,
    );
  }

  for (const cat of plan.categories) {
    const pocketWeightTotal = cat.pockets.reduce((sum, p) => sum + p.weightBp, 0);
    // Pockets may sum to <= 100%; the remainder is captured by Overflow.
    if (pocketWeightTotal > BASIS_POINTS_FULL) {
      errors.push(
        `Pocket percentages in category ${cat.id} cannot exceed 100% (got ${(pocketWeightTotal / 100).toFixed(2)}%).`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Allocate `amountCents` of new money according to the plan. Pure; no IO. Every
 * cent is accounted for: pocketAllocations (including Overflow pockets) plus
 * freeToSpendCents always sum to the input amount.
 */
export function allocate(amountCents: number, plan: FundingPlanInput): AllocationResult {
  if (amountCents <= 0) {
    return {
      pocketAllocations: [],
      freeToSpendCents: Math.max(0, amountCents),
      totalSetAsideCents: 0,
    };
  }

  const topKeys: WeightedKey[] = [
    ...plan.categories.map((c) => ({ key: `cat:${c.id}`, weightBp: c.weightBp })),
    { key: "free_to_spend", weightBp: plan.freeToSpendWeightBp },
  ];
  const topSplit = splitByWeights(amountCents, topKeys);
  const categoryAmount = new Map<string, number>();
  let freeToSpendCents = 0;
  for (const part of topSplit) {
    if (part.key === "free_to_spend") freeToSpendCents += part.amountCents;
    else categoryAmount.set(part.key.slice(4), part.amountCents);
  }

  const pocketAllocations: PocketAllocation[] = [];
  for (const cat of plan.categories) {
    const catAmount = categoryAmount.get(cat.id) ?? 0;
    if (catAmount <= 0) continue;
    const { allocations, freeLeftoverCents } = allocateWithinCategory(catAmount, cat);
    pocketAllocations.push(...allocations);
    freeToSpendCents += freeLeftoverCents;
  }

  const totalSetAsideCents = pocketAllocations.reduce((s, a) => s + a.amountCents, 0);
  return { pocketAllocations, freeToSpendCents, totalSetAsideCents };
}
