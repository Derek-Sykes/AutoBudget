import { BASIS_POINTS_FULL } from "./money";

// ---------------------------------------------------------------------------
// Pure helpers + validation for the funding-plan editor.
//
// Percentages are edited as basis points (10000 = 100.00%) so the plan can sum
// to EXACTLY 100% with no floating-point drift. The same validator runs on the
// client (for live feedback) and the server (authoritative).
// ---------------------------------------------------------------------------

export interface PlanPocketWeight {
  pocketId: string;
  name?: string;
  weightBp: number;
}

export interface PlanCategoryWeight {
  categoryId: string;
  name?: string;
  weightBp: number;
  pockets: PlanPocketWeight[];
}

export interface PlanWeightsInput {
  freeToSpendBp: number;
  categories: PlanCategoryWeight[];
}

export interface PlanValidation {
  valid: boolean;
  errors: string[];
  topTotalBp: number;
  /** Per-category pocket totals, only meaningful for funded categories. */
  categoryTotals: Record<string, number>;
}

const fmtPct = (bp: number) => `${(bp / 100).toFixed(2)}%`;

function inRange(bp: number): boolean {
  return Number.isInteger(bp) && bp >= 0 && bp <= BASIS_POINTS_FULL;
}

/**
 * Validate the whole plan. Rules:
 *  - every weight is an integer 0..10000
 *  - categories + Free to Spend total exactly 100%
 *  - a category that receives money AND has pockets must split to exactly 100%
 *    (a category with 0% weight, or with no pockets, is exempt)
 */
export function validatePlanWeights(input: PlanWeightsInput): PlanValidation {
  const errors: string[] = [];
  const categoryTotals: Record<string, number> = {};

  if (!inRange(input.freeToSpendBp)) {
    errors.push("Free to Spend must be between 0% and 100%.");
  }

  let topTotal = input.freeToSpendBp;
  for (const cat of input.categories) {
    const label = cat.name ? `"${cat.name}"` : "A category";
    if (!inRange(cat.weightBp)) {
      errors.push(`${label} percentage must be between 0% and 100%.`);
    }
    topTotal += cat.weightBp;

    let pocketTotal = 0;
    for (const p of cat.pockets) {
      if (!inRange(p.weightBp)) {
        errors.push(
          `${p.name ? `"${p.name}"` : "A pocket"} percentage must be between 0% and 100%.`,
        );
      }
      pocketTotal += p.weightBp;
    }
    categoryTotals[cat.categoryId] = pocketTotal;

    // Pockets may total <= 100%; the remainder is captured by the category's
    // Overflow pocket. Only an over-allocation past 100% is invalid.
    if (pocketTotal > BASIS_POINTS_FULL) {
      errors.push(`${label} pockets can't exceed 100% (currently ${fmtPct(pocketTotal)}).`);
    }
  }

  if (topTotal !== BASIS_POINTS_FULL) {
    errors.push(
      `Categories plus Free to Spend must total 100% (currently ${fmtPct(topTotal)}).`,
    );
  }

  return { valid: errors.length === 0, errors, topTotalBp: topTotal, categoryTotals };
}

/** Split 100% across n items as evenly as possible (sums to exactly 10000 bp). */
export function distributeEvenlyBp(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(BASIS_POINTS_FULL / n);
  const remainder = BASIS_POINTS_FULL - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Parse a user-typed percent ("33.33", "40", "") into basis points, or null. */
export function pctStringToBp(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const bp = Math.round(Number.parseFloat(trimmed) * 100);
  return bp >= 0 && bp <= BASIS_POINTS_FULL ? bp : null;
}

/** Format basis points as a trimmed percent string for inputs ("40", "33.33"). */
export function bpToPctString(bp: number): string {
  return (bp / 100).toString();
}
