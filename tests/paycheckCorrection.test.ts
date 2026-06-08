import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboardBalances } from "@/server/services/balanceService";
import { reallocate } from "@/server/services/moneyMovement";
import { addPaycheck } from "@/server/services/paycheck";
import { correctPaycheck } from "@/server/services/paycheckCorrection";
import { runPayrollCatchUp } from "@/server/services/payroll";
import { purchasePocket } from "@/server/services/purchaseCancel";
import { reverseBatchById } from "@/server/services/reversal";
import { LedgerError } from "@/server/services/ledger";
import {
  makeCategory,
  makeFundingPlan,
  makeJob,
  makeOverflow,
  makePocket,
  seedUser,
} from "./factories";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const account = (id: string) => prisma.account.findUniqueOrThrow({ where: { id } });
const pocket = (id: string) => prisma.pocket.findUniqueOrThrow({ where: { id } });

async function autoDisperseFixture(startingBalanceCents = 500_000) {
  const { userId, accountId } = await seedUser(startingBalanceCents);
  const category = await makeCategory(userId, "Income");
  const target = await makePocket(userId, category.id, {
    name: "Bills",
    targetCents: 1_000_000,
  });
  const overflow = await makeOverflow(userId, category.id);
  await makeFundingPlan(userId, {
    freeToSpendBp: 0,
    categories: [
      { categoryId: category.id, weightBp: 10000, pockets: [{ pocketId: target.id, weightBp: 10000 }] },
    ],
  });
  return { userId, accountId, categoryId: category.id, pocketId: target.id, overflowId: overflow.id };
}

async function latestPaycheckBatchId(userId: string) {
  const batch = await prisma.moneyMovementBatch.findFirstOrThrow({
    where: { userId, batchType: "PAYCHECK_DEPOSIT" },
    orderBy: { createdAt: "desc" },
  });
  return batch.id;
}

describe("paycheck corrections - manual deposits", () => {
  it("corrects a manual non-auto-distributed paycheck upward into Free to Spend", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const paycheck = await addPaycheck({ userId, amountCents: 100_000, autoDisperse: false });

    const correction = await correctPaycheck({
      userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 150_000,
    });

    expect((await account(accountId)).balanceCents).toBe(650_000);
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(650_000);
    expect(correction.previousAmountCents).toBe(100_000);
    expect(correction.correctedAmountCents).toBe(150_000);
  });

  it("corrects a manual non-auto-distributed paycheck downward from Free to Spend", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const paycheck = await addPaycheck({ userId, amountCents: 100_000, autoDisperse: false });

    await correctPaycheck({
      userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 60_000,
    });

    expect((await account(accountId)).balanceCents).toBe(560_000);
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(560_000);
  });

  it("creates correction activity and ledger batches without rewriting the original paycheck", async () => {
    const { userId } = await seedUser();
    const paycheck = await addPaycheck({ userId, amountCents: 100_000, autoDisperse: false });

    const correction = await correctPaycheck({
      userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 125_000,
    });

    const original = await prisma.moneyMovementBatch.findUniqueOrThrow({ where: { id: paycheck.batchId } });
    const correctionBatch = await prisma.moneyMovementBatch.findUniqueOrThrow({
      where: { id: correction.batchId },
      include: { movements: true },
    });
    const logs = await prisma.activityLog.findMany({
      where: { userId, type: "PAYCHECK_CORRECTED" },
    });

    expect(original.batchType).toBe("PAYCHECK_DEPOSIT");
    expect(original.status).toBe("applied");
    expect(correctionBatch.batchType).toBe("PAYCHECK_CORRECTION");
    expect(correctionBatch.movements.some((m) => m.movementType === "MAIN_ACCOUNT_INCREASE")).toBe(true);
    expect(logs).toHaveLength(1);
  });

  it("can reverse a correction batch as an auditable history entry", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const paycheck = await addPaycheck({ userId, amountCents: 100_000, autoDisperse: false });
    const correction = await correctPaycheck({
      userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 125_000,
    });

    await reverseBatchById({ userId, batchId: correction.batchId });

    expect((await account(accountId)).balanceCents).toBe(600_000);
    const batch = await prisma.moneyMovementBatch.findUniqueOrThrow({ where: { id: correction.batchId } });
    expect(batch.status).toBe("reversed");
  });
});

describe("paycheck corrections - payroll generated paychecks", () => {
  it("corrects a payroll-generated paycheck upward", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, {
      amountCents: 100_000,
      payFrequency: "monthly",
      firstPayDate: d("2026-01-15"),
      autoDisperse: false,
    });
    await runPayrollCatchUp(userId, d("2026-01-15"));

    await correctPaycheck({
      userId,
      batchId: await latestPaycheckBatchId(userId),
      correctedAmountCents: 150_000,
    });

    expect((await account(accountId)).balanceCents).toBe(650_000);
  });

  it("corrects a payroll-generated paycheck downward", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, {
      amountCents: 100_000,
      payFrequency: "monthly",
      firstPayDate: d("2026-01-15"),
      autoDisperse: false,
    });
    await runPayrollCatchUp(userId, d("2026-01-15"));

    await correctPaycheck({
      userId,
      batchId: await latestPaycheckBatchId(userId),
      correctedAmountCents: 60_000,
    });

    expect((await account(accountId)).balanceCents).toBe(560_000);
  });

  it("does not duplicate a corrected payroll paycheck during catch-up", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, {
      amountCents: 100_000,
      payFrequency: "monthly",
      firstPayDate: d("2026-01-15"),
      autoDisperse: false,
    });
    await runPayrollCatchUp(userId, d("2026-01-15"));
    const batchId = await latestPaycheckBatchId(userId);

    await correctPaycheck({ userId, batchId, correctedAmountCents: 150_000 });
    const rerun = await runPayrollCatchUp(userId, d("2026-01-15"));

    expect(rerun.generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(650_000);
    expect(await prisma.moneyMovementBatch.count({ where: { userId, batchType: "PAYCHECK_DEPOSIT" } })).toBe(1);
  });

  it("optionally updates the job amount for future paychecks only", async () => {
    const { userId } = await seedUser();
    const job = await makeJob(userId, {
      amountCents: 100_000,
      payFrequency: "monthly",
      firstPayDate: d("2026-01-15"),
      autoDisperse: false,
    });
    await runPayrollCatchUp(userId, d("2026-01-15"));

    await correctPaycheck({
      userId,
      batchId: await latestPaycheckBatchId(userId),
      correctedAmountCents: 150_000,
      updateFutureJobAmount: true,
    });

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const originalBatch = await prisma.moneyMovementBatch.findFirstOrThrow({
      where: { userId, batchType: "PAYCHECK_DEPOSIT" },
      include: { movements: true },
    });
    expect(updated.amountCents).toBe(150_000);
    expect(originalBatch.movements.find((m) => m.movementType === "MAIN_ACCOUNT_INCREASE")?.amountCents).toBe(100_000);
  });

  it("leaves the job amount unchanged when the future-update checkbox is off", async () => {
    const { userId } = await seedUser();
    const job = await makeJob(userId, {
      amountCents: 100_000,
      payFrequency: "monthly",
      firstPayDate: d("2026-01-15"),
      autoDisperse: false,
    });
    await runPayrollCatchUp(userId, d("2026-01-15"));

    await correctPaycheck({
      userId,
      batchId: await latestPaycheckBatchId(userId),
      correctedAmountCents: 150_000,
      updateFutureJobAmount: false,
    });

    const unchanged = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(unchanged.amountCents).toBe(100_000);
  });
});

describe("paycheck corrections - auto distribution", () => {
  it("corrects an auto-distributed paycheck upward through the funding plan", async () => {
    const f = await autoDisperseFixture();
    const paycheck = await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });

    await correctPaycheck({
      userId: f.userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 150_000,
    });

    expect((await account(f.accountId)).balanceCents).toBe(650_000);
    expect((await pocket(f.pocketId)).currentBalanceCents).toBe(150_000);
    expect((await getDashboardBalances(f.userId)).freeToSpendCents).toBe(500_000);
  });

  it("corrects an auto-distributed paycheck downward when the pocket still has enough money", async () => {
    const f = await autoDisperseFixture();
    const paycheck = await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });

    await correctPaycheck({
      userId: f.userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 60_000,
    });

    expect((await account(f.accountId)).balanceCents).toBe(560_000);
    expect((await pocket(f.pocketId)).currentBalanceCents).toBe(60_000);
    expect((await getDashboardBalances(f.userId)).freeToSpendCents).toBe(500_000);
  });

  it("pulls available money from an originally funded pocket first, then Free to Spend", async () => {
    const f = await autoDisperseFixture();
    const paycheck = await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });
    await reallocate({
      userId: f.userId,
      sourceType: "pocket",
      sourceId: f.pocketId,
      destinationType: "free_to_spend",
      amountCents: 70_000,
    });

    await correctPaycheck({
      userId: f.userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 50_000,
    });

    expect((await account(f.accountId)).balanceCents).toBe(550_000);
    expect((await pocket(f.pocketId)).currentBalanceCents).toBe(0);
    expect((await getDashboardBalances(f.userId)).freeToSpendCents).toBe(550_000);
  });

  it("can make derived Free to Spend negative without making a pocket negative", async () => {
    const f = await autoDisperseFixture(80_000);
    const bufferCategory = await makeCategory(f.userId, "Buffer");
    await makePocket(f.userId, bufferCategory.id, {
      name: "Already set aside",
      targetCents: 1_000_000,
      currentCents: 80_000,
    });
    const paycheck = await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });
    await purchasePocket({
      userId: f.userId,
      pocketId: f.pocketId,
      purchaseAmountCents: 100_000,
    });

    await correctPaycheck({
      userId: f.userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 50_000,
    });

    expect((await account(f.accountId)).balanceCents).toBe(30_000);
    expect((await pocket(f.pocketId)).currentBalanceCents).toBe(0);
    expect((await pocket(f.overflowId)).currentBalanceCents).toBe(50_000);
    const balances = await getDashboardBalances(f.userId);
    expect(balances.setAsideCents).toBe(130_000);
    expect(balances.freeToSpendCents).toBe(-100_000);
  });
});

describe("paycheck corrections - isolation and guards", () => {
  it("rejects a correction that would make a pocket negative", async () => {
    const f = await autoDisperseFixture();
    const paycheck = await addPaycheck({ userId: f.userId, amountCents: 100_000, autoDisperse: true });
    await reallocate({
      userId: f.userId,
      sourceType: "pocket",
      sourceId: f.pocketId,
      destinationType: "free_to_spend",
      amountCents: 100_000,
    });

    await correctPaycheck({
      userId: f.userId,
      batchId: paycheck.batchId,
      correctedAmountCents: 50_000,
    });

    expect((await pocket(f.pocketId)).currentBalanceCents).toBe(0);
  });

  it("does not let user A correct user B's paycheck", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const paycheck = await addPaycheck({ userId: b.userId, amountCents: 100_000, autoDisperse: false });

    await expect(
      correctPaycheck({
        userId: a.userId,
        batchId: paycheck.batchId,
        correctedAmountCents: 150_000,
      }),
    ).rejects.toThrow(LedgerError);
  });
});
