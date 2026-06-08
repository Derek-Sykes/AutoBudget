import { execFileSync } from "node:child_process";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  AuthError,
  changeCurrentUserPassword,
  createSessionRecord,
  createUserAccount,
  deleteSessionToken,
  getCurrentUserForSessionToken,
  hashSessionToken,
  updateCurrentUserProfile,
  verifyLoginCredentials,
} from "@/server/auth";
import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  MAIN_ACCOUNT_NAME,
  getMockStartingBalanceCents,
} from "@/config/mockBank";

describe("local auth accounts", () => {
  it("creates a user with a hashed password and default starter data", async () => {
    const user = await createUserAccount({
      email: "New.User@Example.COM ",
      displayName: "New User",
      password: "password123",
      confirmPassword: "password123",
    });

    expect(user.email).toBe("new.user@example.com");
    expect(user.passwordHash).not.toBe("password123");
    await expect(bcrypt.compare("password123", user.passwordHash)).resolves.toBe(true);

    const [accounts, categories, pockets, plan] = await Promise.all([
      prisma.account.findMany({ where: { userId: user.id } }),
      prisma.category.findMany({ where: { userId: user.id } }),
      prisma.pocket.findMany({ where: { userId: user.id } }),
      prisma.fundingPlan.findFirst({
        where: { userId: user.id, isActive: true },
        include: { rules: true },
      }),
    ]);

    expect(accounts).toEqual([
      expect.objectContaining({
        name: MAIN_ACCOUNT_NAME,
        isMain: true,
        balanceCents: getMockStartingBalanceCents(),
      }),
    ]);
    expect(categories.map((c) => c.name)).toEqual(["Needs", "Goals", "Fun"]);
    expect(pockets.filter((p) => p.isOverflow)).toHaveLength(categories.length);
    for (const category of categories) {
      expect(
        pockets.some(
          (p) => p.userId === user.id && p.categoryId === category.id && p.isOverflow,
        ),
      ).toBe(true);
    }
    expect(plan).toEqual(expect.objectContaining({ name: "Default plan" }));
    expect(plan?.rules).toEqual([
      expect.objectContaining({
        ruleType: "free_to_spend",
        destinationType: "free_to_spend",
        basisPoints: 10_000,
      }),
    ]);
  });

  it("rejects duplicate email addresses case-insensitively", async () => {
    await createUserAccount({
      email: "duplicate@example.com",
      password: "password123",
      confirmPassword: "password123",
    });

    await expect(
      createUserAccount({
        email: " Duplicate@Example.com ",
        password: "password123",
        confirmPassword: "password123",
      }),
    ).rejects.toThrow("An account with that email already exists.");
  });

  it("validates signup email, password length, and password confirmation", async () => {
    await expect(
      createUserAccount({
        email: "not-an-email",
        password: "password123",
        confirmPassword: "password123",
      }),
    ).rejects.toThrow("Enter a valid email address.");

    await expect(
      createUserAccount({
        email: "short@example.com",
        password: "short",
        confirmPassword: "short",
      }),
    ).rejects.toThrow("Password must be at least 8 characters.");

    await expect(
      createUserAccount({
        email: "mismatch@example.com",
        password: "password123",
        confirmPassword: "different123",
      }),
    ).rejects.toThrow("Passwords do not match.");
  });

  it("logs in with the correct password and rejects wrong credentials generically", async () => {
    const user = await createUserAccount({
      email: "login@example.com",
      password: "password123",
      confirmPassword: "password123",
    });

    await expect(
      verifyLoginCredentials({ email: "LOGIN@example.com", password: "password123" }),
    ).resolves.toMatchObject({ id: user.id });

    await expect(
      verifyLoginCredentials({ email: "login@example.com", password: "wrongpassword" }),
    ).rejects.toThrow("Invalid email or password.");
    await expect(
      verifyLoginCredentials({ email: "missing@example.com", password: "password123" }),
    ).rejects.toThrow("Invalid email or password.");
  });

  it("creates expiring hashed sessions and invalidates them on logout", async () => {
    const user = await createUserAccount({
      email: "session@example.com",
      password: "password123",
      confirmPassword: "password123",
    });

    const { token, expiresAt } = await createSessionRecord(user.id);
    expect(token).toHaveLength(43);

    const stored = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(stored).toEqual(expect.objectContaining({ userId: user.id, expiresAt }));
    expect(JSON.stringify(stored)).not.toContain(token);

    await expect(getCurrentUserForSessionToken(token)).resolves.toEqual({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });

    await deleteSessionToken(token);
    await expect(getCurrentUserForSessionToken(token)).resolves.toBeNull();
  });

  it("enforces session expiry", async () => {
    const user = await createUserAccount({
      email: "expired@example.com",
      password: "password123",
      confirmPassword: "password123",
    });
    const { token } = await createSessionRecord(user.id, {
      expiresAt: new Date(Date.now() - 1_000),
    });

    await expect(getCurrentUserForSessionToken(token)).resolves.toBeNull();
    await expect(
      prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) } }),
    ).resolves.toBeNull();
  });

  it("keeps the seeded demo login working", async () => {
    await prisma.$disconnect();
    execFileSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), "prisma/seed.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
      stdio: "ignore",
    });

    await expect(
      verifyLoginCredentials({ email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD }),
    ).resolves.toMatchObject({ email: DEMO_USER_EMAIL, displayName: "Demo User" });
  });

  it("updates the display name and changes the password", async () => {
    const user = await createUserAccount({
      email: "settings@example.com",
      displayName: "Old Name",
      password: "password123",
      confirmPassword: "password123",
    });

    await updateCurrentUserProfile({ userId: user.id, displayName: "New Name" });
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({
      displayName: "New Name",
    });

    await expect(
      changeCurrentUserPassword({
        userId: user.id,
        currentPassword: "wrongpassword",
        newPassword: "newpassword123",
        confirmPassword: "newpassword123",
      }),
    ).rejects.toThrow("Current password is incorrect.");

    await changeCurrentUserPassword({
      userId: user.id,
      currentPassword: "password123",
      newPassword: "newpassword123",
      confirmPassword: "newpassword123",
    });

    await expect(
      verifyLoginCredentials({ email: "settings@example.com", password: "password123" }),
    ).rejects.toThrow("Invalid email or password.");
    await expect(
      verifyLoginCredentials({ email: "settings@example.com", password: "newpassword123" }),
    ).resolves.toMatchObject({ id: user.id });
  });

  it("uses AuthError for auth validation failures", async () => {
    await expect(
      verifyLoginCredentials({ email: "missing@example.com", password: "password123" }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
