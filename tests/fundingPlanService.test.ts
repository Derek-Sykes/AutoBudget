import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getFundingPlanEditorData,
  saveFundingPlan,
} from "@/server/services/fundingPlanService";
import { getActiveFundingPlanInput } from "@/server/services/funding";
import { addPaycheck } from "@/server/services/paycheck";
import { LedgerError } from "@/server/services/ledger";
import { makeCategory, makePocket, seedUser } from "./factories";

async function fixture() {
  const { userId } = await seedUser(500_000);
  const needs = await makeCategory(userId, "Needs");
  const rent = await makePocket(userId, needs.id, { name: "Rent", targetCents: 1_000_000, currentCents: 0 });
  const groceries = await makePocket(userId, needs.id, {
    name: "Groceries",
    targetCents: 1_000_000,
    currentCents: 0,
  });
  return { userId, needsId: needs.id, rentId: rent.id, groceriesId: groceries.id };
}

describe("saveFundingPlan", () => {
  it("persists weights that the allocation engine then reads", async () => {
    const f = await fixture();
    await saveFundingPlan(f.userId, {
      freeToSpendBp: 0,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 10000,
          pockets: [
            { pocketId: f.rentId, weightBp: 6000 },
            { pocketId: f.groceriesId, weightBp: 4000 },
          ],
        },
      ],
    });

    const input = await getActiveFundingPlanInput(f.userId);
    expect(input?.freeToSpendWeightBp).toBe(0);
    expect(input?.categories[0].weightBp).toBe(10000);

    await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });
    expect((await prisma.pocket.findUniqueOrThrow({ where: { id: f.rentId } })).currentBalanceCents).toBe(60_000);
    expect(
      (await prisma.pocket.findUniqueOrThrow({ where: { id: f.groceriesId } })).currentBalanceCents,
    ).toBe(40_000);
  });

  it("rebuilds rules in place rather than accumulating duplicates", async () => {
    const f = await fixture();
    const payload = {
      freeToSpendBp: 2000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 8000,
          pockets: [
            { pocketId: f.rentId, weightBp: 5000 },
            { pocketId: f.groceriesId, weightBp: 5000 },
          ],
        },
      ],
    };
    await saveFundingPlan(f.userId, payload);
    await saveFundingPlan(f.userId, payload);
    // 1 free-to-spend + 1 category + 2 pockets = 4 rules, not 8.
    expect(await prisma.fundingRule.count()).toBe(4);
    expect(await prisma.fundingPlan.count({ where: { userId: f.userId, isActive: true } })).toBe(1);
  });

  it("blocks a plan whose totals are not 100%", async () => {
    const f = await fixture();
    await expect(
      saveFundingPlan(f.userId, {
        freeToSpendBp: 1000, // 1000 + 10000 = 110%
        categories: [
          {
            categoryId: f.needsId,
            weightBp: 10000,
            pockets: [
              { pocketId: f.rentId, weightBp: 6000 },
              { pocketId: f.groceriesId, weightBp: 4000 },
            ],
          },
        ],
      }),
    ).rejects.toThrow(LedgerError);
  });

  it("creates an active plan when none exists yet", async () => {
    const f = await fixture();
    expect(await prisma.fundingPlan.count()).toBe(0);
    await saveFundingPlan(f.userId, {
      freeToSpendBp: 10000,
      categories: [{ categoryId: f.needsId, weightBp: 0, pockets: [
        { pocketId: f.rentId, weightBp: 0 },
        { pocketId: f.groceriesId, weightBp: 0 },
      ] }],
    });
    expect(await prisma.fundingPlan.count({ where: { isActive: true } })).toBe(1);
  });

  it("rejects stale ids (pocket no longer active / wrong category)", async () => {
    const f = await fixture();
    await expect(
      saveFundingPlan(f.userId, {
        freeToSpendBp: 0,
        categories: [
          {
            categoryId: f.needsId,
            weightBp: 10000,
            pockets: [{ pocketId: "does-not-exist", weightBp: 10000 }],
          },
        ],
      }),
    ).rejects.toThrow(LedgerError);
  });
});

describe("getFundingPlanEditorData", () => {
  it("shows a newly added pocket at 0% (no rule yet)", async () => {
    const f = await fixture();
    await saveFundingPlan(f.userId, {
      freeToSpendBp: 4000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 6000,
          pockets: [
            { pocketId: f.rentId, weightBp: 10000 },
            { pocketId: f.groceriesId, weightBp: 0 },
          ],
        },
      ],
    });
    // Add a brand-new active pocket after the plan was saved.
    const fresh = await makePocket(f.userId, f.needsId, { name: "Utilities", targetCents: 50_000 });

    const data = await getFundingPlanEditorData(f.userId);
    const needs = data.categories.find((c) => c.categoryId === f.needsId)!;
    expect(needs.weightBp).toBe(6000);
    const utilities = needs.pockets.find((p) => p.pocketId === fresh.id)!;
    expect(utilities.weightBp).toBe(0);
  });
});
