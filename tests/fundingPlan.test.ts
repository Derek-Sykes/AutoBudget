import { describe, expect, it } from "vitest";
import {
  bpToPctString,
  distributeEvenlyBp,
  pctStringToBp,
  validatePlanWeights,
  type PlanWeightsInput,
} from "@/domain/fundingPlan";

function plan(over: Partial<PlanWeightsInput> = {}): PlanWeightsInput {
  return {
    freeToSpendBp: 2000,
    categories: [
      {
        categoryId: "needs",
        name: "Needs",
        weightBp: 8000,
        pockets: [
          { pocketId: "rent", name: "Rent", weightBp: 7000 },
          { pocketId: "groceries", name: "Groceries", weightBp: 3000 },
        ],
      },
    ],
    ...over,
  };
}

describe("validatePlanWeights", () => {
  it("accepts a balanced plan", () => {
    expect(validatePlanWeights(plan()).valid).toBe(true);
  });

  it("rejects a top-level total that is not 100%", () => {
    const res = validatePlanWeights(plan({ freeToSpendBp: 1000 }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Free to Spend must total"))).toBe(true);
  });

  it("allows category pockets to total under 100% (remainder goes to Overflow)", () => {
    const p = plan();
    p.categories[0].pockets[1].weightBp = 1000; // 7000 + 1000 = 8000 (<=100%)
    expect(validatePlanWeights(p).valid).toBe(true);
  });

  it("rejects category pockets that exceed 100%", () => {
    const p = plan();
    p.categories[0].pockets[1].weightBp = 5000; // 7000 + 5000 = 12000
    const res = validatePlanWeights(p);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Needs"))).toBe(true);
  });

  it("exempts a 0%-weight category from the pocket-balance rule", () => {
    const p = plan({
      freeToSpendBp: 10000,
      categories: [
        {
          categoryId: "needs",
          name: "Needs",
          weightBp: 0,
          pockets: [{ pocketId: "rent", name: "Rent", weightBp: 0 }],
        },
      ],
    });
    expect(validatePlanWeights(p).valid).toBe(true);
  });

  it("exempts a funded category with no pockets (share spills to Free to Spend)", () => {
    const p = plan({
      freeToSpendBp: 2000,
      categories: [{ categoryId: "needs", name: "Needs", weightBp: 8000, pockets: [] }],
    });
    expect(validatePlanWeights(p).valid).toBe(true);
  });

  it("rejects out-of-range percentages", () => {
    const p = plan();
    p.categories[0].weightBp = 12000;
    expect(validatePlanWeights(p).valid).toBe(false);
  });
});

describe("distributeEvenlyBp", () => {
  it("splits to exactly 100% with the remainder on the first items", () => {
    expect(distributeEvenlyBp(3)).toEqual([3334, 3333, 3333]);
    expect(distributeEvenlyBp(4).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(distributeEvenlyBp(0)).toEqual([]);
  });
});

describe("pctStringToBp / bpToPctString", () => {
  it("parses percent strings to basis points", () => {
    expect(pctStringToBp("40")).toBe(4000);
    expect(pctStringToBp("33.33")).toBe(3333);
    expect(pctStringToBp("")).toBe(0);
    expect(pctStringToBp("12.5")).toBe(1250);
  });
  it("rejects invalid or out-of-range percents", () => {
    expect(pctStringToBp("abc")).toBeNull();
    expect(pctStringToBp("150")).toBeNull();
    expect(pctStringToBp("12.345")).toBeNull();
    expect(pctStringToBp("-5")).toBeNull();
  });
  it("formats basis points back to trimmed percents", () => {
    expect(bpToPctString(4000)).toBe("40");
    expect(bpToPctString(3333)).toBe("33.33");
    expect(bpToPctString(0)).toBe("0");
  });
});
