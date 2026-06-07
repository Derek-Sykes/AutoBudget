import { describe, expect, it } from "vitest";
import {
  allocate,
  allocateWithinCategory,
  splitByWeights,
  validateFundingPlan,
  type CategoryWeight,
  type FundingPlanInput,
} from "@/domain/allocation";

describe("splitByWeights", () => {
  it("splits exactly with no lost cents (largest remainder)", () => {
    const r = splitByWeights(100, [
      { key: "a", weightBp: 5000 },
      { key: "b", weightBp: 5000 },
    ]);
    expect(r).toEqual([
      { key: "a", amountCents: 50 },
      { key: "b", amountCents: 50 },
    ]);
  });

  it("splits evenly when all weights are zero", () => {
    const r = splitByWeights(100, [
      { key: "a", weightBp: 0 },
      { key: "b", weightBp: 0 },
      { key: "c", weightBp: 0 },
    ]);
    expect(r.map((x) => x.amountCents)).toEqual([34, 33, 33]);
  });

  it("assigns rounding leftovers deterministically by largest remainder", () => {
    const r = splitByWeights(100, [
      { key: "a", weightBp: 3333 },
      { key: "b", weightBp: 3333 },
      { key: "c", weightBp: 3334 },
    ]);
    expect(r.map((x) => x.amountCents)).toEqual([33, 33, 34]);
    expect(r.reduce((s, x) => s + x.amountCents, 0)).toBe(100);
  });
});

function basicPlan(): FundingPlanInput {
  return {
    freeToSpendWeightBp: 2000,
    categories: [
      {
        id: "needs",
        weightBp: 4000,
        pockets: [
          { id: "rent", weightBp: 7000, capacityCents: Infinity },
          { id: "groceries", weightBp: 3000, capacityCents: Infinity },
        ],
      },
      {
        id: "travel",
        weightBp: 2000,
        pockets: [{ id: "spain", weightBp: 10000, capacityCents: Infinity }],
      },
      {
        id: "invest",
        weightBp: 2000,
        pockets: [{ id: "roth", weightBp: 10000, capacityCents: Infinity }],
      },
    ],
  };
}

describe("validateFundingPlan", () => {
  it("accepts a plan whose categories + free-to-spend total 100%", () => {
    expect(validateFundingPlan(basicPlan()).valid).toBe(true);
  });

  it("rejects category totals that are not 100%", () => {
    const plan = basicPlan();
    plan.freeToSpendWeightBp = 1000; // now totals 90%
    const res = validateFundingPlan(plan);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toMatch(/100%/);
  });

  it("allows category pockets to total under 100% (remainder goes to Overflow)", () => {
    const plan = basicPlan();
    plan.categories[0].pockets[1].weightBp = 1000; // 7000 + 1000 = 8000 (<=100%)
    expect(validateFundingPlan(plan).valid).toBe(true);
  });

  it("rejects category pockets that exceed 100%", () => {
    const plan = basicPlan();
    plan.categories[0].pockets[1].weightBp = 5000; // 7000 + 5000 = 12000
    expect(validateFundingPlan(plan).valid).toBe(false);
  });
});

describe("allocateWithinCategory (Overflow capture)", () => {
  const withOverflow = (pockets: CategoryWeight["pockets"]): CategoryWeight => ({
    id: "needs",
    weightBp: 10000,
    overflowPocketId: "needs-overflow",
    pockets,
  });

  it("routes the unweighted remainder to Overflow", () => {
    // Pockets only claim 60%; the other 40% of $100 -> Overflow.
    const r = allocateWithinCategory(10_000, withOverflow([
      { id: "rent", weightBp: 6000, capacityCents: Infinity },
    ]));
    const byId = Object.fromEntries(r.allocations.map((a) => [a.pocketId, a.amountCents]));
    expect(byId.rent).toBe(6_000);
    expect(byId["needs-overflow"]).toBe(4_000);
    expect(r.freeLeftoverCents).toBe(0);
  });

  it("routes capped-pocket overflow to Overflow (not Free to Spend)", () => {
    const r = allocateWithinCategory(10_000, withOverflow([
      { id: "rent", weightBp: 7000, capacityCents: 2_000 }, // wants 7000, can take 2000
      { id: "groceries", weightBp: 3000, capacityCents: Infinity },
    ]));
    const byId = Object.fromEntries(r.allocations.map((a) => [a.pocketId, a.amountCents]));
    expect(byId.rent).toBe(2_000);
    expect(byId.groceries).toBe(3_000);
    expect(byId["needs-overflow"]).toBe(5_000); // 7000 - 2000 capped excess
    expect(r.freeLeftoverCents).toBe(0);
  });

  it("sends the whole amount to Overflow when there are no normal pockets", () => {
    const r = allocateWithinCategory(10_000, withOverflow([]));
    expect(r.allocations).toEqual([{ pocketId: "needs-overflow", amountCents: 10_000 }]);
  });

  it("conserves every cent into pockets when an Overflow pocket exists", () => {
    const r = allocateWithinCategory(9_999, withOverflow([
      { id: "a", weightBp: 3333, capacityCents: 1_000 },
      { id: "b", weightBp: 3333, capacityCents: Infinity },
    ]));
    const total = r.allocations.reduce((s, a) => s + a.amountCents, 0) + r.freeLeftoverCents;
    expect(total).toBe(9_999);
    expect(r.freeLeftoverCents).toBe(0); // overflow absorbed everything
  });

  it("falls back to Free to Spend only when there is no Overflow pocket", () => {
    const r = allocateWithinCategory(10_000, {
      id: "needs",
      weightBp: 10000,
      pockets: [{ id: "rent", weightBp: 6000, capacityCents: Infinity }],
    });
    expect(r.freeLeftoverCents).toBe(4_000);
  });
});

describe("allocate", () => {
  it("conserves every cent: pockets + free to spend == amount", () => {
    const result = allocate(100_000, basicPlan());
    const total =
      result.pocketAllocations.reduce((s, a) => s + a.amountCents, 0) +
      result.freeToSpendCents;
    expect(total).toBe(100_000);
  });

  it("splits a $1,000 paycheck by the plan", () => {
    const result = allocate(100_000, basicPlan());
    const byPocket = Object.fromEntries(
      result.pocketAllocations.map((a) => [a.pocketId, a.amountCents]),
    );
    // Needs 40% = $400 -> rent 70% ($280), groceries 30% ($120)
    expect(byPocket.rent).toBe(28_000);
    expect(byPocket.groceries).toBe(12_000);
    // Travel 20% = $200 -> spain
    expect(byPocket.spain).toBe(20_000);
    // Invest 20% = $200 -> roth
    expect(byPocket.roth).toBe(20_000);
    // Free to spend 20% = $200
    expect(result.freeToSpendCents).toBe(20_000);
  });

  it("caps pockets at capacity and overflows to Free to Spend", () => {
    const plan = basicPlan();
    plan.categories[1].pockets[0].capacityCents = 5_000; // spain can take only $50
    const result = allocate(100_000, plan); // travel share is $200
    const spain = result.pocketAllocations.find((a) => a.pocketId === "spain");
    expect(spain?.amountCents).toBe(5_000);
    // The unfillable $150 of travel falls back to Free to Spend.
    expect(result.freeToSpendCents).toBe(20_000 + 15_000);
    const total =
      result.pocketAllocations.reduce((s, a) => s + a.amountCents, 0) +
      result.freeToSpendCents;
    expect(total).toBe(100_000);
  });

  it("routes a category with no eligible pockets to Free to Spend", () => {
    const plan = basicPlan();
    plan.categories[1].pockets = []; // travel has no pockets
    const result = allocate(100_000, plan);
    // travel's $200 share now lands in free to spend
    expect(result.freeToSpendCents).toBe(20_000 + 20_000);
  });

  it("sends everything to Free to Spend for a zero/empty plan amount", () => {
    const result = allocate(0, basicPlan());
    expect(result.totalSetAsideCents).toBe(0);
    expect(result.freeToSpendCents).toBe(0);
  });
});
