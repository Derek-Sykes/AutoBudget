import { prisma } from "@/lib/prisma";
import { DEMO_USER_EMAIL, MAIN_ACCOUNT_NAME, getMockStartingBalanceCents } from "@/config/mockBank";

/**
 * MVP has no auth (deferred per the build guide). The whole app operates as a
 * single seeded demo user. This ensures that user and their one simulated Main
 * Account exist, so the dashboard works even before the full seed is run.
 */
export async function ensureDemoUser() {
  let user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: DEMO_USER_EMAIL, displayName: "Demo User" },
    });
  }

  const account = await prisma.account.findFirst({
    where: { userId: user.id, isMain: true },
  });
  if (!account) {
    await prisma.account.create({
      data: {
        userId: user.id,
        name: MAIN_ACCOUNT_NAME,
        accountType: "manual_simulated",
        balanceCents: getMockStartingBalanceCents(),
        isMain: true,
      },
    });
  }

  return user;
}

/** Resolve the current user's id (the demo user in MVP). */
export async function getCurrentUserId(): Promise<string> {
  const user = await ensureDemoUser();
  return user.id;
}
