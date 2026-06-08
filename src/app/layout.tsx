import type { Metadata } from "next";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { logoutAction } from "@/app/auth-actions";
import { getCurrentUser } from "@/server/currentUser";
import { getUnreadNotificationCount } from "@/server/services/notifications";
import { ensurePayrollCurrent } from "@/server/services/payroll";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoBudget - know what's truly free to spend",
  description: "A simulation-only budgeting app that sets money aside into virtual pockets.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  let unreadCount = 0;
  if (user) {
    // Deterministic payroll catch-up on every authenticated page load (idempotent).
    await ensurePayrollCurrent(user.id);
    unreadCount = await getUnreadNotificationCount(user.id);
  }
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:font-medium focus:text-brand-700 focus:shadow-lg focus:ring-2 focus:ring-brand-400"
          >
            Skip to content
          </a>
          <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4">
              <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 font-semibold">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/30">
                  A
                </span>
                <span>AutoBudget</span>
                <span className="badge hidden bg-slate-100 text-muted sm:inline-flex">Simulation</span>
              </Link>
              {user ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none sm:gap-3">
                  <NavLinks unreadCount={unreadCount} />
                  <span className="hidden max-w-40 truncate text-xs text-muted sm:inline">
                    {user.displayName || user.email}
                  </span>
                  <form action={logoutAction}>
                    <button className="btn-ghost px-2.5 py-1.5 text-sm" type="submit">
                      Logout
                    </button>
                  </form>
                </div>
              ) : (
                <nav className="flex items-center gap-2 text-sm">
                  <Link className="btn-ghost px-3 py-1.5" href="/login">
                    Log in
                  </Link>
                  <Link className="btn-primary px-3 py-1.5" href="/signup">
                    Sign up
                  </Link>
                </nav>
              )}
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-3 py-4 outline-none sm:px-4 sm:py-6">
            {children}
          </main>
          <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-muted">
            Simulated balances only. No real money is moved.
          </footer>
        </div>
      </body>
    </html>
  );
}
