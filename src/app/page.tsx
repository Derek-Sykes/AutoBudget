import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/currentUser";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <section className="mx-auto flex min-h-[calc(100vh-11rem)] max-w-2xl flex-col justify-center gap-6">
      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
          Simulation-only budgeting
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Set money aside before you spend it.</h1>
        <p className="text-lg leading-8 text-muted">
          SetAside keeps one clear number for what is truly free to spend, while your categories
          and pockets organize the money you have already committed.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link className="btn-primary" href="/signup">
          Create account
        </Link>
        <Link className="btn-secondary" href="/login">
          Log in
        </Link>
      </div>
    </section>
  );
}
