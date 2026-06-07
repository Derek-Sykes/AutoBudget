import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboardBalances } from "@/server/services/balanceService";
import { setAsideToPocket } from "@/server/services/moneyMovement";
import { addPaycheck } from "@/server/services/paycheck";
import { addPayback } from "@/server/services/payback";
import { purchasePocket, cancelPocket } from "@/server/services/purchaseCancel";
import { reverseBatchById } from "@/server/services/reversal";
import { LedgerError } from "@/server/services/ledger";
import { makeCategory, makeFundingPlan, makeOverflow, makePocket, seedUser } from "./factories";

const account = (id: string) => prisma.account.findUniqueOrThrow({ where: { id } });
const pocket = (id: string) => prisma.pocket.findUniqueOrThrow({ where: { id } });

// A reusable fixture: $5,000 account, two categories, a funding plan.
async function fullFixture() {
  const { userId, accountId } = await seedUser(500_000);
  const needs = await makeCategory(userId, "Needs", 4000);
  const rent = await makePocket(userId, needs.id, {
    name: "Rent",
    targetCents: 100_000,
    currentCents: 80_000,
    weightBp: 7000,
  });
  const groceries = await makePocket(userId, needs.id, {
    name: "Groceries",
    targetCents: 30_000,
    currentCents: 10_000,
    weightBp: 3000,
  });
  const needsOverflow = await makeOverflow(userId, needs.id);
  const travel = await makeCategory(userId, "Travel", 4000);
  const spain = await makePocket(userId, travel.id, {
    name: "Spain",
    targetCents: 120_000,
    currentCents: 40_000,
    weightBp: 10000,
  });
  await makeOverflow(userId, travel.id);
  await makeFundingPlan(userId, {
    freeToSpendBp: 2000,
    categories: [
      {
        categoryId: needs.id,
        weightBp: 4000,
        pockets: [
          { pocketId: rent.id, weightBp: 7000 },
          { pocketId: groceries.id, weightBp: 3000 },
        ],
      },
      { categoryId: travel.id, weightBp: 4000, pockets: [{ pocketId: spain.id, weightBp: 10000 }] },
    ],
  });
  return {
    userId,
    accountId,
    rentId: rent.id,
    groceriesId: groceries.id,
    spainId: spain.id,
    needsOverflowId: needsOverflow.id,
  };
}

describe("balances + manual set-aside", () => {
  it("derives Free to Spend = Main Account balance - Set Aside", async () => {
    const f = await fullFixture();
    const b = await getDashboardBalances(f.userId);
    expect(b.mainAccountBalanceCents).toBe(500_000);
    expect(b.setAsideCents).toBe(130_000); // 80k + 10k + 40k
    expect(b.freeToSpendCents).toBe(370_000);
  });

  it("set-aside increases the pocket and reduces Free to Spend (Main unchanged)", async () => {
    const f = await fullFixture();
    await setAsideToPocket({ userId: f.userId, pocketId: f.spainId, amountCents: 10_000 });
    expect((await pocket(f.spainId)).currentBalanceCents).toBe(50_000);
    expect((await account(f.accountId)).balanceCents).toBe(500_000); // unchanged
    expect((await getDashboardBalances(f.userId)).freeToSpendCents).toBe(360_000);
  });

  it("blocks setting aside more than Free to Spend", async () => {
    const f = await fullFixture();
    await expect(
      setAsideToPocket({ userId: f.userId, pocketId: f.spainId, amountCents: 400_000 }),
    ).rejects.toThrow(LedgerError);
  });

  it("blocks overfunding past the goal", async () => {
    const f = await fullFixture();
    await expect(
      setAsideToPocket({ userId: f.userId, pocketId: f.rentId, amountCents: 30_000 }),
    ).rejects.toThrow(LedgerError);
  });

  it("flips to fully_funded and creates a notification", async () => {
    const f = await fullFixture();
    await setAsideToPocket({ userId: f.userId, pocketId: f.rentId, amountCents: 20_000 });
    expect((await pocket(f.rentId)).status).toBe("fully_funded");
    const notes = await prisma.notification.findMany({ where: { type: "POCKET_FULLY_FUNDED" } });
    expect(notes).toHaveLength(1);
  });
});

describe("paycheck deposit", () => {
  it("auto-disperses exactly the deposit, caps at capacity, sends overflow to the Overflow pocket", async () => {
    const f = await fullFixture();
    await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });

    expect((await account(f.accountId)).balanceCents).toBe(600_000);
    // Needs share is $400. Rent wants $280 but only has $200 of room (-> fully
    // funded); its $80 excess lands in the Needs Overflow pocket. Groceries gets
    // its literal 30% = $120.
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(100_000);
    expect((await pocket(f.rentId)).status).toBe("fully_funded");
    expect((await pocket(f.groceriesId)).currentBalanceCents).toBe(22_000);
    expect((await pocket(f.needsOverflowId)).currentBalanceCents).toBe(8_000);
    expect((await pocket(f.spainId)).currentBalanceCents).toBe(80_000);

    const b = await getDashboardBalances(f.userId);
    expect(b.setAsideCents).toBe(210_000); // 100k + 22k + 8k + 80k
    expect(b.freeToSpendCents).toBe(390_000); // 370k + only the 20% FTS share
  });

  it("leaves everything Free to Spend when auto_disperse is off", async () => {
    const f = await fullFixture();
    await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: false });
    expect((await account(f.accountId)).balanceCents).toBe(600_000);
    expect((await pocket(f.spainId)).currentBalanceCents).toBe(40_000); // unchanged
    expect((await getDashboardBalances(f.userId)).freeToSpendCents).toBe(470_000);
  });

  it("rejects zero and negative deposits", async () => {
    const f = await fullFixture();
    await expect(addPaycheck({ userId: f.userId, amountCents: 0 })).rejects.toThrow();
    await expect(addPaycheck({ userId: f.userId, amountCents: -5_000 })).rejects.toThrow();
  });

  it("is idempotent for a repeated request key", async () => {
    const f = await fullFixture();
    const key = "deposit-123";
    await addPaycheck({ userId: f.userId, amountCents: 50_000, autoDisperse: false, idempotencyKey: key });
    const second = await addPaycheck({
      userId: f.userId,
      amountCents: 50_000,
      autoDisperse: false,
      idempotencyKey: key,
    });
    expect(second.idempotentReplay).toBe(true);
    expect((await account(f.accountId)).balanceCents).toBe(550_000); // only applied once
  });
});

describe("payback / refund", () => {
  it("unlinked payback to Free to Spend raises Main + Free to Spend only", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await addPayback({ userId, amountCents: 3_000, restoreMode: "free_to_spend" });
    expect((await account(accountId)).balanceCents).toBe(503_000);
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(503_000);
  });

  it("manual destination restores a chosen active pocket (Free to Spend unchanged)", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Travel");
    const p = await makePocket(userId, cat.id, { targetCents: 100_000, currentCents: 20_000 });
    const beforeFts = (await getDashboardBalances(userId)).freeToSpendCents;
    await addPayback({
      userId,
      amountCents: 5_000,
      restoreMode: "manual_destination",
      manualDestinationType: "pocket",
      manualDestinationId: p.id,
    });
    expect((await account(accountId)).balanceCents).toBe(505_000);
    expect((await pocket(p.id)).currentBalanceCents).toBe(25_000);
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(beforeFts);
  });

  it("exact restore returns a Free-to-Spend-funded purchase to Free to Spend", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Electronics");
    const p = await makePocket(userId, cat.id, { targetCents: 50_000, currentCents: 0 });
    // Purchase $100 entirely from Free to Spend (pocket has no balance).
    const purchase = await purchasePocket({ userId, pocketId: p.id, purchaseAmountCents: 10_000 });
    expect((await account(accountId)).balanceCents).toBe(490_000);

    await addPayback({
      userId,
      amountCents: 10_000,
      restoreMode: "exact_original_destinations",
      linkedBatchId: purchase.batchId,
    });
    expect((await account(accountId)).balanceCents).toBe(500_000);
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(500_000);
  });

  it("blocks over-payback beyond the original amount", async () => {
    const { userId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Electronics");
    const p = await makePocket(userId, cat.id, { targetCents: 50_000, currentCents: 0 });
    const purchase = await purchasePocket({ userId, pocketId: p.id, purchaseAmountCents: 10_000 });
    await expect(
      addPayback({
        userId,
        amountCents: 20_000,
        restoreMode: "exact_original_destinations",
        linkedBatchId: purchase.batchId,
      }),
    ).rejects.toThrow(LedgerError);
  });

  it("asks for a destination when the original pocket is no longer restorable", async () => {
    const { userId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Travel");
    const p = await makePocket(userId, cat.id, { targetCents: 50_000, currentCents: 30_000 });
    // Clean purchase closes the pocket (status -> purchased).
    const purchase = await purchasePocket({ userId, pocketId: p.id, purchaseAmountCents: 30_000 });
    await expect(
      addPayback({
        userId,
        amountCents: 30_000,
        restoreMode: "exact_original_destinations",
        linkedBatchId: purchase.batchId,
      }),
    ).rejects.toThrow(LedgerError);
  });
});

describe("purchase + cancel", () => {
  it("purchase within balance releases leftover to Free to Spend", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Electronics");
    const p = await makePocket(userId, cat.id, { targetCents: 50_000, currentCents: 50_000, status: "fully_funded" });
    await purchasePocket({ userId, pocketId: p.id, purchaseAmountCents: 45_000 });
    expect((await account(accountId)).balanceCents).toBe(455_000);
    expect((await pocket(p.id)).status).toBe("purchased");
    const b = await getDashboardBalances(userId);
    expect(b.setAsideCents).toBe(0); // purchased pocket excluded
    expect(b.freeToSpendCents).toBe(455_000); // leftover $50 released
  });

  it("purchase above pocket balance pulls the shortfall from Free to Spend", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Electronics");
    const p = await makePocket(userId, cat.id, { targetCents: 50_000, currentCents: 20_000 });
    await purchasePocket({ userId, pocketId: p.id, purchaseAmountCents: 50_000 });
    expect((await account(accountId)).balanceCents).toBe(450_000);
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(450_000);
  });

  it("blocks a purchase larger than pocket + Free to Spend", async () => {
    const { userId } = await seedUser(30_000);
    const cat = await makeCategory(userId, "Electronics");
    const p = await makePocket(userId, cat.id, { targetCents: 100_000, currentCents: 20_000 });
    await expect(
      purchasePocket({ userId, pocketId: p.id, purchaseAmountCents: 40_000 }),
    ).rejects.toThrow(LedgerError);
  });

  it("cancel releases the pocket balance to Free to Spend, Main unchanged", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Travel");
    const p = await makePocket(userId, cat.id, { targetCents: 100_000, currentCents: 30_000 });
    await cancelPocket({ userId, pocketId: p.id });
    expect((await account(accountId)).balanceCents).toBe(500_000);
    expect((await pocket(p.id)).status).toBe("cancelled");
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(500_000);
  });
});

describe("safe reversal", () => {
  it("cleanly reverses a paycheck deposit, undoing exact allocations", async () => {
    const f = await fullFixture();
    const result = await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });
    await reverseBatchById({ userId: f.userId, batchId: result.batchId });

    expect((await account(f.accountId)).balanceCents).toBe(500_000);
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(80_000);
    expect((await pocket(f.rentId)).status).toBe("active"); // un-funded again
    expect((await pocket(f.groceriesId)).currentBalanceCents).toBe(10_000);
    expect((await pocket(f.spainId)).currentBalanceCents).toBe(40_000);

    const batch = await prisma.moneyMovementBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.status).toBe("reversed");
  });

  it("blocks reversing the same batch twice", async () => {
    const f = await fullFixture();
    const result = await addPaycheck({ userId: f.userId, amountCents: 50_000, autoDisperse: false });
    await reverseBatchById({ userId: f.userId, batchId: result.batchId });
    await expect(
      reverseBatchById({ userId: f.userId, batchId: result.batchId }),
    ).rejects.toThrow(LedgerError);
  });

  it("blocks reversal when allocated funds were already spent", async () => {
    const { userId } = await seedUser(500_000);
    const cat = await makeCategory(userId, "Travel");
    const p = await makePocket(userId, cat.id, { targetCents: 100_000, currentCents: 0 });
    const setAside = await setAsideToPocket({ userId, pocketId: p.id, amountCents: 10_000 });
    // Spend the pocket (closes it), so the set-aside can't be cleanly reversed.
    await purchasePocket({ userId, pocketId: p.id, purchaseAmountCents: 10_000 });
    await expect(
      reverseBatchById({ userId, batchId: setAside.batchId }),
    ).rejects.toThrow(LedgerError);
  });
});
