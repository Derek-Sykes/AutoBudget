import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getFundingPlanEditorData,
  saveFundingPlan,
} from "@/server/services/fundingPlanService";
import { getActiveFundingPlanInput } from "@/server/services/funding";
import { addPaycheck } from "@/server/services/paycheck";
import { LedgerError } from "@/server/services/ledger";
import { createCategory } from "@/server/services/catalog";
import { makeCategory, makeOverflow, makePocket, seedUser } from "./factories";

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

  it("auto-splits active normal pockets evenly when a 0% category becomes funded", async () => {
    const f = await fixture();
    await saveFundingPlan(f.userId, {
      freeToSpendBp: 10000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 0,
          pockets: [
            { pocketId: f.rentId, weightBp: 0 },
            { pocketId: f.groceriesId, weightBp: 0 },
          ],
        },
      ],
    });

    await saveFundingPlan(f.userId, {
      freeToSpendBp: 8000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 2000,
          pockets: [
            { pocketId: f.rentId, weightBp: 0 },
            { pocketId: f.groceriesId, weightBp: 0 },
          ],
        },
      ],
    });

    const rules = await prisma.fundingRule.findMany({
      where: { destinationType: "pocket" },
      orderBy: { createdAt: "asc" },
    });
    expect(rules.map((rule) => rule.basisPoints)).toEqual([5000, 5000]);
  });

  it("handles odd basis-point remainders deterministically", async () => {
    const f = await fixture();
    const utilities = await makePocket(f.userId, f.needsId, {
      name: "Utilities",
      targetCents: 1_000_000,
    });

    await saveFundingPlan(f.userId, {
      freeToSpendBp: 10000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 0,
          pockets: [
            { pocketId: f.rentId, weightBp: 0 },
            { pocketId: f.groceriesId, weightBp: 0 },
            { pocketId: utilities.id, weightBp: 0 },
          ],
        },
      ],
    });
    await saveFundingPlan(f.userId, {
      freeToSpendBp: 9000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 1000,
          pockets: [
            { pocketId: f.rentId, weightBp: 0 },
            { pocketId: f.groceriesId, weightBp: 0 },
            { pocketId: utilities.id, weightBp: 0 },
          ],
        },
      ],
    });

    const rules = await prisma.fundingRule.findMany({
      where: { destinationType: "pocket" },
      orderBy: { createdAt: "asc" },
    });
    expect(rules.map((rule) => rule.basisPoints)).toEqual([3334, 3333, 3333]);
    expect(rules.reduce((sum, rule) => sum + (rule.basisPoints ?? 0), 0)).toBe(10000);
  });

  it("preserves existing non-zero pocket allocations", async () => {
    const f = await fixture();
    await saveFundingPlan(f.userId, {
      freeToSpendBp: 10000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 0,
          pockets: [
            { pocketId: f.rentId, weightBp: 7000 },
            { pocketId: f.groceriesId, weightBp: 3000 },
          ],
        },
      ],
    });

    await saveFundingPlan(f.userId, {
      freeToSpendBp: 8000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 2000,
          pockets: [
            { pocketId: f.rentId, weightBp: 7000 },
            { pocketId: f.groceriesId, weightBp: 3000 },
          ],
        },
      ],
    });

    const rules = await prisma.fundingRule.findMany({
      where: { destinationType: "pocket" },
      orderBy: { createdAt: "asc" },
    });
    expect(rules.map((rule) => rule.basisPoints)).toEqual([7000, 3000]);
  });

  it("routes a funded category with no normal pockets to Overflow", async () => {
    const { userId } = await seedUser(500_000);
    const category = await createCategory({ userId, name: "Travel" });
    const overflow = await prisma.pocket.findFirstOrThrow({
      where: { userId, categoryId: category.id, isOverflow: true },
    });

    await saveFundingPlan(userId, {
      freeToSpendBp: 0,
      categories: [{ categoryId: category.id, weightBp: 10000, pockets: [] }],
    });
    await addPaycheck({ userId, amountCents: 100_000, autoDisperse: true });

    expect((await prisma.pocket.findUniqueOrThrow({ where: { id: overflow.id } })).currentBalanceCents).toBe(100_000);
  });

  it("does not auto-split other categories", async () => {
    const f = await fixture();
    const travel = await makeCategory(f.userId, "Travel");
    const spain = await makePocket(f.userId, travel.id, { name: "Spain", targetCents: 1_000_000 });
    const italy = await makePocket(f.userId, travel.id, { name: "Italy", targetCents: 1_000_000 });
    await makeOverflow(f.userId, travel.id);

    await saveFundingPlan(f.userId, {
      freeToSpendBp: 10000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 0,
          pockets: [
            { pocketId: f.rentId, weightBp: 0 },
            { pocketId: f.groceriesId, weightBp: 0 },
          ],
        },
        {
          categoryId: travel.id,
          weightBp: 0,
          pockets: [
            { pocketId: spain.id, weightBp: 0 },
            { pocketId: italy.id, weightBp: 0 },
          ],
        },
      ],
    });
    await saveFundingPlan(f.userId, {
      freeToSpendBp: 8000,
      categories: [
        {
          categoryId: f.needsId,
          weightBp: 2000,
          pockets: [
            { pocketId: f.rentId, weightBp: 0 },
            { pocketId: f.groceriesId, weightBp: 0 },
          ],
        },
        {
          categoryId: travel.id,
          weightBp: 0,
          pockets: [
            { pocketId: spain.id, weightBp: 0 },
            { pocketId: italy.id, weightBp: 0 },
          ],
        },
      ],
    });

    const data = await getFundingPlanEditorData(f.userId);
    expect(data.categories.find((category) => category.categoryId === f.needsId)?.pockets.map((p) => p.weightBp)).toEqual([5000, 5000]);
    expect(data.categories.find((category) => category.categoryId === travel.id)?.pockets.map((p) => p.weightBp)).toEqual([0, 0]);
  });

  it("does not let user A save rules for user B's funding plan", async () => {
    const a = await fixture();
    const b = await fixture();

    await expect(
      saveFundingPlan(a.userId, {
        freeToSpendBp: 0,
        categories: [
          {
            categoryId: b.needsId,
            weightBp: 10000,
            pockets: [{ pocketId: b.rentId, weightBp: 10000 }],
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
