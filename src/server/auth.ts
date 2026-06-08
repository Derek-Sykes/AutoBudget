import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createDefaultUserData } from "@/server/services/onboarding";

export const SESSION_COOKIE_NAME = "autobudget_session";
const SESSION_DAYS = 14;
const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const MIN_PASSWORD_LENGTH = 8;

export class AuthError extends Error {}

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

function validateEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError("Enter a valid email address.");
  }
}

function validatePassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password: string, passwordHash: string | null): Promise<boolean> {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

export async function createSessionRecord(
  userId: string,
  options: { token?: string; expiresAt?: Date } = {},
) {
  const token = options.token ?? randomBytes(32).toString("base64url");
  const expiresAt = options.expiresAt ?? sessionExpiry();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function createSession(userId: string) {
  const { token, expiresAt } = await createSessionRecord(userId);

  await setSessionCookie(token, expiresAt);
}

export async function createUserAccount(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName?: string;
}) {
  const email = normalizeEmail(input.email);
  validateEmail(email);
  validatePassword(input.password);

  if (input.password !== input.confirmPassword) {
    throw new AuthError("Passwords do not match.");
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new AuthError("An account with that email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName?.trim() || null;

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          displayName,
          passwordHash,
        },
      });
      await createDefaultUserData(tx, created.id);
      return created;
    });

    return user;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      throw new AuthError("An account with that email already exists.");
    }
    throw error;
  }
}

export async function signUp(input: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName?: string;
}) {
  const user = await createUserAccount(input);
  await createSession(user.id);
  return user;
}

export async function verifyLoginCredentials(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  validateEmail(email);

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await verifyPassword(input.password, user?.passwordHash ?? null);
  if (!user || !valid) {
    throw new AuthError("Invalid email or password.");
  }

  return user;
}

export async function logIn(input: { email: string; password: string }) {
  const user = await verifyLoginCredentials(input);
  await createSession(user.id);
  return user;
}

export async function deleteSessionToken(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function getCurrentUserForSessionToken(
  token: string | null | undefined,
): Promise<CurrentUser | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const user = await getCurrentUserForSessionToken(token);
  if (!user) await clearSessionCookie();
  return user;
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireCurrentUserId(): Promise<string> {
  return (await requireCurrentUser()).id;
}

export async function getCurrentUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Please log in again.");
  return user.id;
}

export async function logOut() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await deleteSessionToken(token);
  }
  await clearSessionCookie();
}

export async function updateCurrentUserProfile(input: {
  userId: string;
  displayName?: string;
}) {
  const displayName = input.displayName?.trim() || null;
  return prisma.user.update({
    where: { id: input.userId },
    data: { displayName },
  });
}

export async function changeCurrentUserPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  validatePassword(input.newPassword);
  if (input.newPassword !== input.confirmPassword) {
    throw new AuthError("New passwords do not match.");
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AuthError("Current password is incorrect.");
  }

  await prisma.user.update({
    where: { id: input.userId },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });
}
