"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AuthError,
  changeCurrentUserPassword,
  logIn,
  logOut,
  requireCurrentUserId,
  signUp,
  updateCurrentUserProfile,
} from "@/server/auth";

export type AuthActionState = { ok: boolean; error?: string };

function fail(error: unknown): AuthActionState {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  console.error(error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

const str = (fd: FormData, key: string) => (fd.get(key) ?? "").toString().trim();

export async function signupAction(
  _prev: AuthActionState,
  fd: FormData,
): Promise<AuthActionState> {
  try {
    await signUp({
      email: str(fd, "email"),
      displayName: str(fd, "displayName") || undefined,
      password: str(fd, "password"),
      confirmPassword: str(fd, "confirmPassword"),
    });
  } catch (error) {
    return fail(error);
  }
  redirect("/dashboard");
}

export async function loginAction(
  _prev: AuthActionState,
  fd: FormData,
): Promise<AuthActionState> {
  try {
    await logIn({
      email: str(fd, "email"),
      password: str(fd, "password"),
    });
  } catch (error) {
    return fail(error);
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await logOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function updateProfileAction(
  _prev: AuthActionState,
  fd: FormData,
): Promise<AuthActionState> {
  try {
    const userId = await requireCurrentUserId();
    await updateCurrentUserProfile({ userId, displayName: str(fd, "displayName") });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function changePasswordAction(
  _prev: AuthActionState,
  fd: FormData,
): Promise<AuthActionState> {
  try {
    const userId = await requireCurrentUserId();
    await changeCurrentUserPassword({
      userId,
      currentPassword: str(fd, "currentPassword"),
      newPassword: str(fd, "newPassword"),
      confirmPassword: str(fd, "confirmPassword"),
    });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
