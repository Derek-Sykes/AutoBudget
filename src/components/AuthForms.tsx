"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AuthActionState } from "@/app/auth-actions";
import {
  changePasswordAction,
  deleteAccountAction,
  loginAction,
  signupAction,
  updateProfileAction,
} from "@/app/auth-actions";
import { Overlay } from "./Dialog";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full justify-center" disabled={pending}>
      {pending ? "Working..." : label}
    </button>
  );
}

function DangerSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-danger" disabled={pending}>
      {pending ? "Working..." : label}
    </button>
  );
}

function FormMessage({ state }: { state: AuthActionState }) {
  if (state.ok) {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-positive">
        Saved.
      </p>
    );
  }
  if (!state.error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
      {state.error}
    </p>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, { ok: false });
  return (
    <form action={formAction} className="card mx-auto max-w-md space-y-4">
      <div>
        <label className="label">Email</label>
        <input className="input" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div>
        <label className="label">Password</label>
        <input
          className="input"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton label="Log in" />
      <p className="text-center text-sm text-muted">
        Need an account?{" "}
        <Link className="font-medium text-brand-700 hover:underline" href="/signup">
          Sign up
        </Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, { ok: false });
  return (
    <form action={formAction} className="card mx-auto max-w-md space-y-4">
      <div>
        <label className="label">Display name</label>
        <input className="input" name="displayName" autoComplete="name" />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label">Password</label>
        <input
          className="input"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div>
        <label className="label">Confirm password</label>
        <input
          className="input"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton label="Create account" />
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link className="font-medium text-brand-700 hover:underline" href="/login">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, formAction] = useActionState(updateProfileAction, { ok: false });
  return (
    <form action={formAction} className="card space-y-4">
      <h2 className="text-lg font-semibold">Profile</h2>
      <div>
        <label className="label">Display name</label>
        <input className="input" name="displayName" defaultValue={displayName} />
      </div>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <button className="btn-primary" type="submit">
          Save profile
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, { ok: false });
  return (
    <form action={formAction} className="card space-y-4">
      <h2 className="text-lg font-semibold">Password</h2>
      <div>
        <label className="label">Current password</label>
        <input className="input" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <label className="label">New password</label>
        <input className="input" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input
          className="input"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <button className="btn-primary" type="submit">
          Change password
        </button>
      </div>
    </form>
  );
}

export function DeleteAccountForm({ isDemo }: { isDemo: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(deleteAccountAction, { ok: false });

  if (isDemo) {
    return (
      <section className="card space-y-2 border-amber-200 bg-amber-50">
        <h2 className="text-lg font-semibold">Delete account</h2>
        <p className="text-sm text-amber-900">
          The demo account cannot be deleted. Create a regular local account to test account
          deletion.
        </p>
      </section>
    );
  }

  return (
    <section className="card space-y-3 border-red-200">
      <div>
        <h2 className="text-lg font-semibold">Delete account</h2>
        <p className="text-sm text-muted">
          Permanently removes your account, sessions, and all budgeting history.
        </p>
      </div>
      <button type="button" className="btn-danger w-fit" onClick={() => setOpen(true)}>
        Delete account
      </button>
      {open && (
        <Overlay title="Delete account" onClose={() => setOpen(false)}>
          <form action={formAction} className="space-y-4">
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-danger">
              This hard-deletes your account and all user-owned AutoBudget data. This cannot be
              undone.
            </p>
            <div>
              <label className="label">Current password</label>
              <input
                className="input"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Type DELETE to confirm</label>
              <input className="input" name="confirmation" required />
            </div>
            <FormMessage state={state} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <DangerSubmitButton label="Delete permanently" />
            </div>
          </form>
        </Overlay>
      )}
    </section>
  );
}
