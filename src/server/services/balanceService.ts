import { prisma } from "@/lib/prisma";
import type { Tx } from "@/lib/prisma";
import { computeFreeToSpend } from "@/domain/money";
import { SET_ASIDE_STATUSES } from "@/domain/types";

export interface DashboardBalances {
  mainAccountBalanceCents: number;
  setAsideCents: number;
  freeToSpendCents: number;
}

type Db = typeof prisma | Tx;

/** Fetch the user's single simulated Main Account. */
export async function getMainAccount(userId: string, db: Db = prisma) {
  const account = await db.account.findFirst({
    where: { userId, isMain: true },
  });
  if (!account) throw new Error("Main Account not found for user. Did you seed the database?");
  return account;
}

/**
 * Dashboard balances: Main Account balance, Set Aside (sum of committed pocket
 * balances + category unallocated), and the DERIVED Free to Spend. Free to Spend
 * is never stored independently.
 */
export async function getDashboardBalances(
  userId: string,
  db: Db = prisma,
): Promise<DashboardBalances> {
  const account = await getMainAccount(userId, db);

  const pocketAgg = await db.pocket.aggregate({
    where: { userId, status: { in: SET_ASIDE_STATUSES } },
    _sum: { currentBalanceCents: true },
  });

  const categoryAgg = await db.category.aggregate({
    where: { userId, status: "active" },
    _sum: { unallocatedCents: true },
  });

  const setAsideCents =
    (pocketAgg._sum.currentBalanceCents ?? 0) + (categoryAgg._sum.unallocatedCents ?? 0);

  return {
    mainAccountBalanceCents: account.balanceCents,
    setAsideCents,
    freeToSpendCents: computeFreeToSpend(account.balanceCents, setAsideCents),
  };
}

/** Free to Spend at this instant, used as a guard before set-aside/purchase. */
export async function getFreeToSpend(userId: string, db: Db = prisma): Promise<number> {
  const { freeToSpendCents } = await getDashboardBalances(userId, db);
  return freeToSpendCents;
}
