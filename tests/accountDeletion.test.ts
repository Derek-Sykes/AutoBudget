import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createSessionRecord,
  createUserAccount,
  deleteUserAccount,
  getCurrentUserForSessionToken,
  verifyLoginCredentials,
} from "@/server/auth";
import { DEMO_USER_EMAIL } from "@/config/mockBank";
import { createCategory, createPocket } from "@/server/services/catalog";
import { addPaycheck } from "@/server/services/paycheck";
import { runPayrollCatchUp } from "@/server/services/payroll";
import { createNotification } from "@/server/services/activity";
import { makeJob } from "./factories";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function realUser(email = "delete-me@example.com") {
  return createUserAccount({
    email,
    displayName: "Delete Me",
    password: "password123",
    confirmPassword: "password123",
  });
}

async function addOwnedData(userId: string) {
  const category = await createCategory({ userId, name: "Travel" });
  const pocket = await createPocket({
    userId,
    categoryId: category.id,
    name: "Spain",
    targetAmountCents: 100_000,
  });
  await makeJob(userId, {
    amountCents: 100_000,
    payFrequency: "monthly",
    firstPayDate: d("2026-01-15"),
    autoDisperse: false,
  });
  await runPayrollCatchUp(userId, d("2026-01-15"));
  await addPaycheck({ userId, amountCents: 50_000, autoDisperse: false });
  await prisma.$transaction((tx) =>
    createNotification(tx, {
      userId,
      type: "FREE_TO_SPEND_LOW",
      title: "Heads up",
      message: "Test notification",
    }),
  );
  return { categoryId: category.id, pocketId: pocket.id };
}

async function ownedCounts(userId: string) {
  const plans = await prisma.fundingPlan.findMany({ where: { userId }, select: { id: true } });
  const planIds = plans.map((plan) => plan.id);
  const batches = await prisma.moneyMovementBatch.findMany({
    where: { userId },
    select: { id: true },
  });
  const batchIds = batches.map((batch) => batch.id);

  return {
    sessions: await prisma.session.count({ where: { userId } }),
    accounts: await prisma.account.count({ where: { userId } }),
    categories: await prisma.category.count({ where: { userId } }),
    pockets: await prisma.pocket.count({ where: { userId } }),
    fundingPlans: plans.length,
    fundingRules: await prisma.fundingRule.count({
      where: { fundingPlanId: { in: planIds } },
    }),
    jobs: await prisma.job.count({ where: { userId } }),
    batches: batches.length,
    movements: await prisma.moneyMovement.count({ where: { batchId: { in: batchIds } } }),
    activity: await prisma.activityLog.count({ where: { userId } }),
    notifications: await prisma.notification.count({ where: { userId } }),
    transactions: await prisma.transaction.count({ where: { userId } }),
  };
}

describe("account deletion", () => {
  it("deletes a user's account, sessions, and owned budgeting data", async () => {
    const user = await realUser();
    await addOwnedData(user.id);
    const { token } = await createSessionRecord(user.id);

    await deleteUserAccount({
      userId: user.id,
      currentPassword: "password123",
      confirmation: "DELETE",
    });

    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toBeNull();
    await expect(getCurrentUserForSessionToken(token)).resolves.toBeNull();
    await expect(
      verifyLoginCredentials({ email: "delete-me@example.com", password: "password123" }),
    ).rejects.toThrow("Invalid email or password.");
    expect(await ownedCounts(user.id)).toEqual({
      sessions: 0,
      accounts: 0,
      categories: 0,
      pockets: 0,
      fundingPlans: 0,
      fundingRules: 0,
      jobs: 0,
      batches: 0,
      movements: 0,
      activity: 0,
      notifications: 0,
      transactions: 0,
    });
  });

  it("rejects deletion with the wrong password", async () => {
    const user = await realUser();

    await expect(
      deleteUserAccount({
        userId: user.id,
        currentPassword: "wrongpassword",
        confirmation: "DELETE",
      }),
    ).rejects.toThrow("Current password is incorrect.");
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
  });

  it("rejects deletion without the exact DELETE confirmation", async () => {
    const user = await realUser();

    await expect(
      deleteUserAccount({
        userId: user.id,
        currentPassword: "password123",
        confirmation: "delete",
      }),
    ).rejects.toThrow("Type DELETE to confirm account deletion.");
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
  });

  it("does not allow deleting the seeded demo account", async () => {
    const user = await createUserAccount({
      email: DEMO_USER_EMAIL,
      password: "password123",
      confirmPassword: "password123",
    });

    await expect(
      deleteUserAccount({
        userId: user.id,
        currentPassword: "password123",
        confirmation: "DELETE",
      }),
    ).rejects.toThrow("The demo account cannot be deleted.");
  });

  it("does not delete or mutate another user's data", async () => {
    const a = await realUser("delete-a@example.com");
    const b = await realUser("keep-b@example.com");
    await addOwnedData(a.id);
    await addOwnedData(b.id);
    const beforeB = await ownedCounts(b.id);

    await deleteUserAccount({
      userId: a.id,
      currentPassword: "password123",
      confirmation: "DELETE",
    });

    expect(await ownedCounts(b.id)).toEqual(beforeB);
    await expect(
      verifyLoginCredentials({ email: "keep-b@example.com", password: "password123" }),
    ).resolves.toMatchObject({ id: b.id });
  });

  it("only deletes the authenticated user's own account", async () => {
    const a = await realUser("self-delete@example.com");
    const b = await realUser("not-targeted@example.com");

    await deleteUserAccount({
      userId: a.id,
      currentPassword: "password123",
      confirmation: "DELETE",
    });

    await expect(prisma.user.findUnique({ where: { id: a.id } })).resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: b.id } })).resolves.not.toBeNull();
  });
});
