import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { transfer } from "@/server/services/transfer";
import { getDashboardBalances } from "@/server/services/balanceService";
import { reverseBatchById } from "@/server/services/reversal";
import { LedgerError } from "@/server/services/ledger";
import { makeCategory, makeFundingPlan, makeOverflow, makePocket, seedUser } from "./factories";

const pocket = (id: string) => prisma.pocket.findUniqueOrThrow({ where: { id } });

async function pair() {
  const { userId, accountId } = await seedUser(500_000);
  const cat = await makeCategory(userId, "C");
  const a = await makePocket(userId, cat.id, { name: "A", currentCents: 200_000, targetCents: null });
  const b = await makePocket(userId, cat.id, { name: "B", currentCents: 0, targetCents: 100_000 });
  return { userId, accountId, aId: a.id, bId: b.id };
}

describe("transfer: pocket -> pocket / Free to Spend", () => {
  it("moves money between pockets, leaving Main + Set Aside unchanged", async () => {
    const f = await pair();
    const before = await getDashboardBalances(f.userId);
    await transfer({
      userId: f.userId,
      sourcePocketId: f.aId,
      destinationType: "pocket",
      destinationId: f.bId,
      amountCents: 20_000,
    });
    expect((await pocket(f.aId)).currentBalanceCents).toBe(180_000);
    expect((await pocket(f.bId)).currentBalanceCents).toBe(20_000);
    const after = await getDashboardBalances(f.userId);
    expect(after.mainAccountBalanceCents).toBe(before.mainAccountBalanceCents);
    expect(after.setAsideCents).toBe(before.setAsideCents);
  });

  it("blocks transferring more than the source holds", async () => {
    const f = await pair();
    await expect(
      transfer({ userId: f.userId, sourcePocketId: f.aId, destinationType: "pocket", destinationId: f.bId, amountCents: 300_000 }),
    ).rejects.toThrow(LedgerError);
  });

  it("blocks overfunding the destination past its goal", async () => {
    const f = await pair();
    await expect(
      transfer({ userId: f.userId, sourcePocketId: f.aId, destinationType: "pocket", destinationId: f.bId, amountCents: 150_000 }),
    ).rejects.toThrow(LedgerError);
  });

  it("blocks transferring to itself", async () => {
    const f = await pair();
    await expect(
      transfer({ userId: f.userId, sourcePocketId: f.aId, destinationType: "pocket", destinationId: f.aId, amountCents: 10_000 }),
    ).rejects.toThrow(LedgerError);
  });

  it("releases money to Free to Spend (Set Aside down, Main unchanged)", async () => {
    const f = await pair();
    const before = await getDashboardBalances(f.userId);
    await transfer({ userId: f.userId, sourcePocketId: f.aId, destinationType: "free_to_spend", amountCents: 20_000 });
    expect((await pocket(f.aId)).currentBalanceCents).toBe(180_000);
    const after = await getDashboardBalances(f.userId);
    expect(after.setAsideCents).toBe(before.setAsideCents - 20_000);
    expect(after.freeToSpendCents).toBe(before.freeToSpendCents + 20_000);
    expect(after.mainAccountBalanceCents).toBe(before.mainAccountBalanceCents);
  });

  it("reverses a transfer cleanly", async () => {
    const f = await pair();
    const r = await transfer({ userId: f.userId, sourcePocketId: f.aId, destinationType: "pocket", destinationId: f.bId, amountCents: 20_000 });
    await reverseBatchById({ userId: f.userId, batchId: r.batchId });
    expect((await pocket(f.aId)).currentBalanceCents).toBe(200_000);
    expect((await pocket(f.bId)).currentBalanceCents).toBe(0);
  });
});

describe("transfer: pocket -> category (auto-distribute)", () => {
  async function categoryFixture(pocketWeights: { rent: number; groceries: number }) {
    const { userId } = await seedUser(500_000);
    const src = await makeCategory(userId, "Src");
    const source = await makePocket(userId, src.id, { name: "Source", currentCents: 100_000, targetCents: null });
    const needs = await makeCategory(userId, "Needs");
    const rent = await makePocket(userId, needs.id, { name: "Rent", targetCents: 1_000_000 });
    const groceries = await makePocket(userId, needs.id, { name: "Groceries", targetCents: 1_000_000 });
    const overflow = await makeOverflow(userId, needs.id);
    const pockets = [] as { pocketId: string; weightBp: number }[];
    if (pocketWeights.rent) pockets.push({ pocketId: rent.id, weightBp: pocketWeights.rent });
    if (pocketWeights.groceries) pockets.push({ pocketId: groceries.id, weightBp: pocketWeights.groceries });
    await makeFundingPlan(userId, {
      freeToSpendBp: 0,
      categories: [{ categoryId: needs.id, weightBp: 10000, pockets }],
    });
    return { userId, srcId: source.id, needsId: needs.id, rentId: rent.id, groceriesId: groceries.id, overflowId: overflow.id };
  }

  it("distributes by pocket weights and conserves Set Aside", async () => {
    const f = await categoryFixture({ rent: 6000, groceries: 4000 });
    const before = await getDashboardBalances(f.userId);
    await transfer({ userId: f.userId, sourcePocketId: f.srcId, destinationType: "category", destinationId: f.needsId, amountCents: 100_000 });
    expect((await pocket(f.srcId)).currentBalanceCents).toBe(0);
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(60_000);
    expect((await pocket(f.groceriesId)).currentBalanceCents).toBe(40_000);
    expect((await pocket(f.overflowId)).currentBalanceCents).toBe(0);
    const after = await getDashboardBalances(f.userId);
    expect(after.setAsideCents).toBe(before.setAsideCents); // money stayed committed
    expect(after.mainAccountBalanceCents).toBe(before.mainAccountBalanceCents);
  });

  it("sends the sub-100% remainder to the Overflow pocket", async () => {
    const f = await categoryFixture({ rent: 6000, groceries: 0 });
    await transfer({ userId: f.userId, sourcePocketId: f.srcId, destinationType: "category", destinationId: f.needsId, amountCents: 100_000 });
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(60_000);
    expect((await pocket(f.overflowId)).currentBalanceCents).toBe(40_000);
  });

  it("sends everything to Overflow when the category has only an Overflow pocket", async () => {
    const { userId } = await seedUser(500_000);
    const src = await makeCategory(userId, "Src");
    const source = await makePocket(userId, src.id, { name: "Source", currentCents: 50_000, targetCents: null });
    const empty = await makeCategory(userId, "Empty");
    const overflow = await makeOverflow(userId, empty.id);
    await makeFundingPlan(userId, { freeToSpendBp: 0, categories: [{ categoryId: empty.id, weightBp: 10000, pockets: [] }] });
    await transfer({ userId, sourcePocketId: source.id, destinationType: "category", destinationId: empty.id, amountCents: 50_000 });
    expect((await pocket(overflow.id)).currentBalanceCents).toBe(50_000);
    expect((await pocket(source.id)).currentBalanceCents).toBe(0);
  });
});
