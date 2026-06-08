import { redirect } from "next/navigation";
import { LoginForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/server/currentUser";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">Log in</h1>
        <p className="mt-2 text-sm text-muted">Use your SetAside account to continue.</p>
      </div>
      <LoginForm />
    </div>
  );
}
