import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { runPayrollCatchUp } from "@/server/services/payroll";
import { createJob, updateJob, setJobStatus } from "@/server/services/jobs";
import { getDashboardBalances } from "@/server/services/balanceService";
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
const paycheckBatchCount = (userId: string) =>
  prisma.moneyMovementBatch.count({ where: { userId, batchType: "PAYCHECK_DEPOSIT" } });

describe("payroll catch-up — scheduling", () => {
  it("processes multiple jobs independently in one run", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { name: "A", amountCents: 100_000, payFrequency: "weekly", firstPayDate: d("2026-01-02") });
    await makeJob(userId, { name: "B", amountCents: 200_000, payFrequency: "monthly", firstPayDate: d("2026-01-15") });

    const res = await runPayrollCatchUp(userId, d("2026-01-16"));
    expect(res.generated).toBe(4); // A: 01-02,01-09,01-16 ; B: 01-15
    // 3*$1000 + 1*$2000 = $5000 added (auto-disperse off -> all stays in Main)
    expect((await account(accountId)).balanceCents).toBe(1_000_000);
  });

  it("does not pay before the first pay date", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { payFrequency: "weekly", firstPayDate: d("2026-06-01") });
    const res = await runPayrollCatchUp(userId, d("2026-05-31"));
    expect(res.generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(500_000);
  });

  it("pays on the exact pay date", async () => {
    const { userId } = await seedUser(500_000);
    await makeJob(userId, { payFrequency: "weekly", firstPayDate: d("2026-06-01") });
    expect((await runPayrollCatchUp(userId, d("2026-06-01"))).generated).toBe(1);
  });

  it("generates one paycheck for a single missed payday", async () => {
    const { userId } = await seedUser(500_000);
    await makeJob(userId, { payFrequency: "weekly", firstPayDate: d("2026-01-02"), lastPaidDate: d("2026-01-02") });
    expect((await runPayrollCatchUp(userId, d("2026-01-09"))).generated).toBe(1);
  });

  it("generates one paycheck per missed payday for multiple missed", async () => {
    const { userId } = await seedUser(500_000);
    await makeJob(userId, { payFrequency: "weekly", firstPayDate: d("2026-01-02"), lastPaidDate: d("2026-01-02") });
    expect((await runPayrollCatchUp(userId, d("2026-01-23"))).generated).toBe(3); // 09,16,23
  });

  it("advances lastPaidDate to the latest processed pay date", async () => {
    const { userId } = await seedUser(500_000);
    const job = await makeJob(userId, { payFrequency: "weekly", firstPayDate: d("2026-01-02") });
    await runPayrollCatchUp(userId, d("2026-01-16"));
    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.lastPaidDate?.toISOString().slice(0, 10)).toBe("2026-01-16");
  });
});

describe("payroll catch-up — idempotency", () => {
  it("creates no duplicate money when run twice with the same clock", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { amountCents: 100_000, payFrequency: "weekly", firstPayDate: d("2026-01-02") });

    const first = await runPayrollCatchUp(userId, d("2026-01-16"));
    expect(first.generated).toBe(3);
    const balanceAfterFirst = (await account(accountId)).balanceCents;
    const batchesAfterFirst = await paycheckBatchCount(userId);

    const second = await runPayrollCatchUp(userId, d("2026-01-16"));
    expect(second.generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(balanceAfterFirst);
    expect(await paycheckBatchCount(userId)).toBe(batchesAfterFirst);
  });

  it("creates no duplicates across repeated 'page refresh' style runs", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { amountCents: 100_000, payFrequency: "weekly", firstPayDate: d("2026-01-02") });
    for (let i = 0; i < 5; i += 1) await runPayrollCatchUp(userId, d("2026-01-16"));
    expect((await account(accountId)).balanceCents).toBe(800_000); // 500k + 3*100k
    expect(await paycheckBatchCount(userId)).toBe(3);
  });
});

describe("payroll catch-up — status gating", () => {
  it("paused jobs do not pay", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { status: "paused", payFrequency: "weekly", firstPayDate: d("2026-01-02") });
    expect((await runPayrollCatchUp(userId, d("2026-01-16"))).generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(500_000);
  });

  it("archived jobs do not pay", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { status: "archived", payFrequency: "weekly", firstPayDate: d("2026-01-02") });
    expect((await runPayrollCatchUp(userId, d("2026-01-16"))).generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(500_000);
  });
});

describe("payroll catch-up — allocation", () => {
  async function fundedFixture(autoDisperse: boolean, pocketWeightBp = 10000, rentTarget = 10_000_000) {
    const { userId, accountId } = await seedUser(500_000);
    const needs = await makeCategory(userId, "Needs");
    const rent = await makePocket(userId, needs.id, { name: "Rent", targetCents: rentTarget });
    const overflow = await makeOverflow(userId, needs.id);
    await makeFundingPlan(userId, {
      freeToSpendBp: 0,
      categories: [{ categoryId: needs.id, weightBp: 10000, pockets: [{ pocketId: rent.id, weightBp: pocketWeightBp }] }],
    });
    await makeJob(userId, { amountCents: 100_000, payFrequency: "monthly", firstPayDate: d("2026-01-15"), autoDisperse });
    return { userId, accountId, rentId: rent.id, overflowId: overflow.id };
  }

  it("auto-disperse ON routes the paycheck through the funding plan", async () => {
    const f = await fundedFixture(true);
    await runPayrollCatchUp(f.userId, d("2026-01-15"));
    expect((await account(f.accountId)).balanceCents).toBe(600_000);
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(100_000); // 100% to Rent
    expect((await getDashboardBalances(f.userId)).freeToSpendCents).toBe(500_000);
  });

  it("auto-disperse OFF leaves the paycheck in Free to Spend", async () => {
    const f = await fundedFixture(false);
    await runPayrollCatchUp(f.userId, d("2026-01-15"));
    expect((await account(f.accountId)).balanceCents).toBe(600_000);
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(0);
    expect((await getDashboardBalances(f.userId)).freeToSpendCents).toBe(600_000);
  });

  it("overflow still captures the excess on a generated paycheck", async () => {
    // Rent caps at $500; the rest of the $1000 lands in the Overflow pocket.
    const f = await fundedFixture(true, 10000, 50_000);
    await runPayrollCatchUp(f.userId, d("2026-01-15"));
    expect((await pocket(f.rentId)).currentBalanceCents).toBe(50_000);
    expect((await pocket(f.overflowId)).currentBalanceCents).toBe(50_000);
  });
});

describe("payroll catch-up — reversal & history", () => {
  it("a generated paycheck can be reversed through the existing system", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { amountCents: 100_000, payFrequency: "monthly", firstPayDate: d("2026-01-15") });
    await runPayrollCatchUp(userId, d("2026-01-15"));
    expect((await account(accountId)).balanceCents).toBe(600_000);

    const batch = await prisma.moneyMovementBatch.findFirstOrThrow({
      where: { userId, batchType: "PAYCHECK_DEPOSIT" },
    });
    await reverseBatchById({ userId, batchId: batch.id });
    expect((await account(accountId)).balanceCents).toBe(500_000);
  });

  it("does not re-create a reversed generated paycheck on the next catch-up", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await makeJob(userId, { amountCents: 100_000, payFrequency: "monthly", firstPayDate: d("2026-01-15") });
    await runPayrollCatchUp(userId, d("2026-01-15"));
    const batch = await prisma.moneyMovementBatch.findFirstOrThrow({
      where: { userId, batchType: "PAYCHECK_DEPOSIT" },
    });
    await reverseBatchById({ userId, batchId: batch.id });
    // Re-running catch-up must NOT regenerate the (reversed) paycheck.
    const res = await runPayrollCatchUp(userId, d("2026-01-15"));
    expect(res.generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(500_000);
  });

  it("editing a job does not duplicate past paychecks", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const job = await makeJob(userId, { amountCents: 100_000, payFrequency: "weekly", firstPayDate: d("2026-01-02") });
    await runPayrollCatchUp(userId, d("2026-01-16")); // 3 paychecks -> $800k
    expect((await account(accountId)).balanceCents).toBe(800_000);

    await updateJob({
      userId,
      jobId: job.id,
      name: "Raise",
      amountCents: 150_000,
      payFrequency: "weekly",
      firstPayDate: d("2026-01-02"),
      autoDisperse: false,
    });
    const res = await runPayrollCatchUp(userId, d("2026-01-16"));
    expect(res.generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(800_000); // unchanged
    expect(await paycheckBatchCount(userId)).toBe(3);
  });

  it("archiving a job preserves its paycheck history and stops future pay", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const job = await makeJob(userId, { amountCents: 100_000, payFrequency: "weekly", firstPayDate: d("2026-01-02") });
    await runPayrollCatchUp(userId, d("2026-01-16"));
    const batchesBefore = await paycheckBatchCount(userId);
    expect(batchesBefore).toBe(3);

    await setJobStatus({ userId, jobId: job.id, status: "archived" });
    expect(await paycheckBatchCount(userId)).toBe(3); // history preserved

    const res = await runPayrollCatchUp(userId, d("2026-01-30"));
    expect(res.generated).toBe(0);
    expect((await account(accountId)).balanceCents).toBe(800_000);
  });
});

describe("job validation", () => {
  it("rejects a non-positive amount", async () => {
    const { userId } = await seedUser();
    await expect(
      createJob({ userId, name: "X", amountCents: 0, payFrequency: "weekly", firstPayDate: d("2026-01-02"), autoDisperse: false }),
    ).rejects.toThrow(LedgerError);
  });

  it("rejects an invalid pay schedule", async () => {
    const { userId } = await seedUser();
    await expect(
      // @ts-expect-error testing runtime guard with a bad frequency
      createJob({ userId, name: "X", amountCents: 1000, payFrequency: "daily", firstPayDate: d("2026-01-02"), autoDisperse: false }),
    ).rejects.toThrow(LedgerError);
  });

  it("rejects invalid semi-monthly days", async () => {
    const { userId } = await seedUser();
    await expect(
      createJob({
        userId,
        name: "X",
        amountCents: 1000,
        payFrequency: "semimonthly",
        firstPayDate: d("2026-01-02"),
        autoDisperse: false,
        semiMonthlyDay1: 15,
        semiMonthlyDay2: 15,
      }),
    ).rejects.toThrow(LedgerError);
  });

  it("requires a name", async () => {
    const { userId } = await seedUser();
    await expect(
      createJob({ userId, name: "  ", amountCents: 1000, payFrequency: "weekly", firstPayDate: d("2026-01-02"), autoDisperse: false }),
    ).rejects.toThrow(LedgerError);
  });
});
