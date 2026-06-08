import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDashboardBalances } from "@/server/services/balanceService";
import { createCategory } from "@/server/services/catalog";
import { addPaycheck } from "@/server/services/paycheck";
import { setAsideToPocket } from "@/server/services/moneyMovement";
import { reverseBatchById } from "@/server/services/reversal";
import { clearNotification } from "@/server/services/notifications";
import { setJobStatus, updateJob } from "@/server/services/jobs";
import { runPayrollCatchUp } from "@/server/services/payroll";
import { getFundingPlanEditorData } from "@/server/services/fundingPlanService";
import { getCategoryDetail } from "@/server/queries";
import {
  makeCategory,
  makeFundingPlan,
  makeJob,
  makeOverflow,
  makePocket,
  seedUser,
} from "./factories";

const dueDate = new Date("2026-01-01T00:00:00.000Z");
const now = new Date("2026-01-08T00:00:00.000Z");

describe("authenticated user isolation", () => {
  it("does not let user A read user B's category detail", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const bCategory = await makeCategory(b.userId, "B private");

    await expect(getCategoryDetail(a.userId, bCategory.id)).resolves.toBeNull();
  });

  it("does not let user A mutate user B's pocket", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const bCategory = await makeCategory(b.userId, "B private");
    const bPocket = await makePocket(b.userId, bCategory.id, {
      name: "B pocket",
      targetCents: 100_000,
    });

    await expect(
      setAsideToPocket({ userId: a.userId, pocketId: bPocket.id, amountCents: 10_000 }),
    ).rejects.toThrow("Pocket not found.");
    await expect(prisma.pocket.findUnique({ where: { id: bPocket.id } })).resolves.toMatchObject({
      currentBalanceCents: 0,
    });
  });

  it("does not let user A reverse user B's ledger batch", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const deposit = await addPaycheck({
      userId: b.userId,
      amountCents: 25_000,
      autoDisperse: false,
    });

    await expect(
      reverseBatchById({ userId: a.userId, batchId: deposit.batchId }),
    ).rejects.toThrow("Batch not found.");
    await expect(
      prisma.moneyMovementBatch.findUnique({ where: { id: deposit.batchId } }),
    ).resolves.toMatchObject({ userId: b.userId, status: "applied" });
  });

  it("does not let user A clear user B's notifications", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const notification = await prisma.notification.create({
      data: {
        userId: b.userId,
        type: "TEST",
        title: "Private",
        message: "Only B can clear this.",
      },
    });

    await clearNotification(a.userId, notification.id);
    await expect(
      prisma.notification.findUnique({ where: { id: notification.id } }),
    ).resolves.toMatchObject({ userId: b.userId });
  });

  it("does not let user A edit, pause, resume, or archive user B's jobs", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const bJob = await makeJob(b.userId, {
      name: "B job",
      firstPayDate: dueDate,
      autoDisperse: false,
    });

    await expect(
      updateJob({
        userId: a.userId,
        jobId: bJob.id,
        name: "Stolen",
        amountCents: 123_00,
        payFrequency: "weekly",
        firstPayDate: dueDate,
        autoDisperse: false,
      }),
    ).rejects.toThrow("Job not found.");

    for (const status of ["paused", "active", "archived"] as const) {
      await expect(
        setJobStatus({ userId: a.userId, jobId: bJob.id, status }),
      ).rejects.toThrow("Job not found.");
    }

    await expect(prisma.job.findUnique({ where: { id: bJob.id } })).resolves.toMatchObject({
      userId: b.userId,
      name: "B job",
      status: "active",
    });
  });

  it("runs payroll catch-up only for the current user's jobs", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const aJob = await makeJob(a.userId, {
      name: "A job",
      firstPayDate: dueDate,
      autoDisperse: false,
    });
    const bJob = await makeJob(b.userId, {
      name: "B job",
      firstPayDate: dueDate,
      autoDisperse: false,
    });

    await expect(runPayrollCatchUp(a.userId, now)).resolves.toMatchObject({ generated: 2 });

    await expect(
      prisma.moneyMovementBatch.count({ where: { userId: a.userId, batchType: "PAYCHECK_DEPOSIT" } }),
    ).resolves.toBe(2);
    await expect(
      prisma.moneyMovementBatch.count({ where: { userId: b.userId, batchType: "PAYCHECK_DEPOSIT" } }),
    ).resolves.toBe(0);
    await expect(prisma.job.findUnique({ where: { id: aJob.id } })).resolves.toMatchObject({
      lastPaidDate: now,
    });
    await expect(prisma.job.findUnique({ where: { id: bJob.id } })).resolves.toMatchObject({
      lastPaidDate: null,
    });
  });

  it("only shows the current user's funding plan categories and pockets", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const aCategory = await makeCategory(a.userId, "A category");
    const bCategory = await makeCategory(b.userId, "B category");
    const aPocket = await makePocket(a.userId, aCategory.id, {
      name: "A pocket",
      targetCents: 100_000,
    });
    const bPocket = await makePocket(b.userId, bCategory.id, {
      name: "B pocket",
      targetCents: 100_000,
    });
    await makeFundingPlan(a.userId, {
      freeToSpendBp: 0,
      categories: [{ categoryId: aCategory.id, weightBp: 10_000, pockets: [{ pocketId: aPocket.id, weightBp: 10_000 }] }],
    });
    await makeFundingPlan(b.userId, {
      freeToSpendBp: 0,
      categories: [{ categoryId: bCategory.id, weightBp: 10_000, pockets: [{ pocketId: bPocket.id, weightBp: 10_000 }] }],
    });

    const data = await getFundingPlanEditorData(a.userId);
    expect(data.categories.map((c) => c.categoryId)).toEqual([aCategory.id]);
    expect(data.categories.flatMap((c) => c.pockets.map((p) => p.pocketId))).toEqual([
      aPocket.id,
    ]);
  });

  it("creates overflow pockets per user and category", async () => {
    const a = await seedUser();
    const b = await seedUser();

    const aCategory = await createCategory({ userId: a.userId, name: "A new" });
    const bCategory = await createCategory({ userId: b.userId, name: "B new" });

    await expect(
      prisma.pocket.findFirst({
        where: { userId: a.userId, categoryId: aCategory.id, isOverflow: true },
      }),
    ).resolves.toMatchObject({ userId: a.userId, categoryId: aCategory.id });
    await expect(
      prisma.pocket.findFirst({
        where: { userId: b.userId, categoryId: bCategory.id, isOverflow: true },
      }),
    ).resolves.toMatchObject({ userId: b.userId, categoryId: bCategory.id });
  });

  it("keeps existing money flows working for an authenticated user id", async () => {
    const { userId } = await seedUser(500_000);
    const category = await makeCategory(userId, "Goals");
    const pocket = await makePocket(userId, category.id, {
      name: "Laptop",
      targetCents: 100_000,
    });

    await addPaycheck({ userId, amountCents: 50_000, autoDisperse: false });
    await setAsideToPocket({ userId, pocketId: pocket.id, amountCents: 20_000 });

    await expect(getDashboardBalances(userId)).resolves.toMatchObject({
      mainAccountBalanceCents: 550_000,
      setAsideCents: 20_000,
      freeToSpendCents: 530_000,
    });
  });

  it("keeps overflow pockets scoped when test helpers build categories manually", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const aCategory = await makeCategory(a.userId, "A manual");
    const bCategory = await makeCategory(b.userId, "B manual");

    const aOverflow = await makeOverflow(a.userId, aCategory.id);
    const bOverflow = await makeOverflow(b.userId, bCategory.id);

    expect(aOverflow.userId).toBe(a.userId);
    expect(aOverflow.categoryId).toBe(aCategory.id);
    expect(bOverflow.userId).toBe(b.userId);
    expect(bOverflow.categoryId).toBe(bCategory.id);
  });
});
