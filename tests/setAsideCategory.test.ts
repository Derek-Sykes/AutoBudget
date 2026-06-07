import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { setAsideToCategory } from "@/server/services/moneyMovement";
import { getDashboardBalances } from "@/server/services/balanceService";
import { reverseBatchById } from "@/server/services/reversal";
import { LedgerError } from "@/server/services/ledger";
import { makeCategory, makeFundingPlan, makeOverflow, makePocket, seedUser } from "./factories";

const pocket = (id: string) => prisma.pocket.findUniqueOrThrow({ where: { id } });
const account = (id: string) => prisma.account.findUniqueOrThrow({ where: { id } });

async function fixture(pocketWeights: { rent: number; groceries: number }, rentTarget = 1_000_000) {
  const { userId, accountId } = await seedUser(500_000);
  const needs = await makeCategory(userId, "Needs");
  const rent = await makePocket(userId, needs.id, { name: "Rent", targetCents: rentTarget });
  const groceries = await makePocket(userId, needs.id, { name: "Groceries", targetCents: 1_000_000 });
  const overflow = await makeOverflow(userId, needs.id);
  const pockets = [] as { pocketId: string; weightBp: number }[];
  if (pocketWeights.rent) pockets.push({ pocketId: rent.id, weightBp: pocketWeights.rent });
  if (pocketWeights.groceries) pockets.push({ pocketId: groceries.id, weightBp: pocketWeights.groceries });
  await makeFundingPlan(userId, {
    freeToSpendBp: 0,
    categories: [{ categoryId: needs.id, weightBp: 10000, pockets }],
  });
  return {
    userId,
    accountId,
    needsId: needs.id,
    rentId: rent.id,
    groceriesId: groceries.id,
    overflowId: overflow.id,
  };
}

describe("setAsideToCategory", () => {
  it("auto-distributes by pocket weights; Set Aside up, Free to Spend down, Main unchanged", async () => {
    const f = await fixture({ rent: 6000, groceries: 4000 });
    const before = await getDashboardBalances(f.userId);
    await setAsideToCategory({ userId: f.userId, categoryId: f.needsId, amountCents: 100_000 });

    expect((await pocket(f.rentId)).currentBalanceCents).toBe(60_000);
    expect((await pocket(f.groceriesId)).currentBalanceCents).toBe(40_000);
    expect((await pocket(f.overflowId)).currentBalanceCents).toBe(0);

    const after = await getDashboardBalances(f.userId);
    expect(after.mainAccountBalanceCents).toBe(before.mainAccountBalanceCents); // unchanged
    expect(after.setAsideCents).toBe(before.setAsideCents + 100_000);
    expect(after.freeToSpendCents).toBe(before.freeToSpendCents - 100_000);
  });

  it("sends the sub-100% remainder to the Overflow pocket", async () => {
    const f = await fixture({ rent: 6000, groceries: 0 });
    await setAsideToCategory({ userId: f.userId, categoryId: f.needsId, amountCents: 100_000 });
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(60_000);
    expect((await pocket(f.overflowId)).currentBalanceCents).toBe(40_000);
  });

  it("caps a pocket at its goal (excess to Overflow) and flips it fully funded", async () => {
    const f = await fixture({ rent: 10000, groceries: 0 }, 50_000); // rent claims 100%, caps at $500
    await setAsideToCategory({ userId: f.userId, categoryId: f.needsId, amountCents: 100_000 });
    const rent = await pocket(f.rentId);
    expect(rent.currentBalanceCents).toBe(50_000);
    expect(rent.status).toBe("fully_funded");
    expect((await pocket(f.overflowId)).currentBalanceCents).toBe(50_000);
    const notes = await prisma.notification.findMany({ where: { type: "POCKET_FULLY_FUNDED" } });
    expect(notes.length).toBeGreaterThan(0);
  });

  it("blocks funding more than Free to Spend", async () => {
    const f = await fixture({ rent: 6000, groceries: 4000 });
    await expect(
      setAsideToCategory({ userId: f.userId, categoryId: f.needsId, amountCents: 600_000 }),
    ).rejects.toThrow(LedgerError);
  });

  it("is reversible", async () => {
    const f = await fixture({ rent: 6000, groceries: 4000 });
    const r = await setAsideToCategory({ userId: f.userId, categoryId: f.needsId, amountCents: 100_000 });
    await reverseBatchById({ userId: f.userId, batchId: r.batchId });
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(0);
    expect((await pocket(f.groceriesId)).currentBalanceCents).toBe(0);
    expect((await account(f.accountId)).balanceCents).toBe(500_000);
  });
});
