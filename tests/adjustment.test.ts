import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { manualAdjust } from "@/server/services/adjustment";
import { getDashboardBalances } from "@/server/services/balanceService";
import { reverseBatchById } from "@/server/services/reversal";
import { LedgerError } from "@/server/services/ledger";
import { makeCategory, makePocket, seedUser } from "./factories";

const account = (id: string) => prisma.account.findUniqueOrThrow({ where: { id } });

describe("manualAdjust", () => {
  it("increase raises Main Account and Free to Spend, never auto-disperses", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await manualAdjust({ userId, direction: "increase", amountCents: 25_000, note: "Found cash" });
    expect((await account(accountId)).balanceCents).toBe(525_000);
    const b = await getDashboardBalances(userId);
    expect(b.setAsideCents).toBe(0);
    expect(b.freeToSpendCents).toBe(525_000);
  });

  it("decrease lowers Main Account and Free to Spend", async () => {
    const { userId, accountId } = await seedUser(500_000);
    await manualAdjust({ userId, direction: "decrease", amountCents: 25_000, note: "Bank fee" });
    expect((await account(accountId)).balanceCents).toBe(475_000);
    expect((await getDashboardBalances(userId)).freeToSpendCents).toBe(475_000);
  });

  it("blocks a decrease larger than Free to Spend (protects committed money)", async () => {
    const { userId } = await seedUser(100_000);
    const cat = await makeCategory(userId, "Needs");
    await makePocket(userId, cat.id, { targetCents: 80_000, currentCents: 80_000, status: "fully_funded" });
    // Free to Spend is only $200; a $500 reduction must be blocked.
    await expect(
      manualAdjust({ userId, direction: "decrease", amountCents: 50_000, note: "oops" }),
    ).rejects.toThrow(LedgerError);
  });

  it("requires a note", async () => {
    const { userId } = await seedUser();
    await expect(
      manualAdjust({ userId, direction: "increase", amountCents: 1_000, note: "  " }),
    ).rejects.toThrow(LedgerError);
  });

  it("rejects zero and negative amounts", async () => {
    const { userId } = await seedUser();
    await expect(
      manualAdjust({ userId, direction: "increase", amountCents: 0, note: "x" }),
    ).rejects.toThrow();
    await expect(
      manualAdjust({ userId, direction: "decrease", amountCents: -100, note: "x" }),
    ).rejects.toThrow();
  });

  it("is reversible", async () => {
    const { userId, accountId } = await seedUser(500_000);
    const r = await manualAdjust({ userId, direction: "increase", amountCents: 30_000, note: "Correction" });
    await reverseBatchById({ userId, batchId: r.batchId });
    expect((await account(accountId)).balanceCents).toBe(500_000);
  });
});
