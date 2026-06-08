import { logoutAction } from "@/app/auth-actions";
import { PasswordForm, ProfileForm } from "@/components/AuthForms";
import { requireCurrentUser } from "@/server/currentUser";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireCurrentUser();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account</h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
        <form action={logoutAction}>
          <button className="btn-secondary" type="submit">
            Logout
          </button>
        </form>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileForm displayName={user.displayName ?? ""} />
        <PasswordForm />
      </div>
    </div>
  );
}
