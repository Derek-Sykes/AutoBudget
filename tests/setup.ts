import { afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

// Wipe all tables before each test so cases are isolated. Order respects
// foreign keys (children first).
beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.moneyMovement.deleteMany();
  await prisma.moneyMovementBatch.deleteMany();
  await prisma.fundingRule.deleteMany();
  await prisma.fundingPlan.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.job.deleteMany();
  await prisma.pocket.deleteMany();
  await prisma.category.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
