import type { Metadata } from "next";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { getCurrentUserId } from "@/server/currentUser";
import { getUnreadNotificationCount } from "@/server/services/notifications";
import { ensurePayrollCurrent } from "@/server/services/payroll";
import "./globals.css";

export const metadata: Metadata = {
  title: "SetAside — know what's truly free to spend",
  description: "A simulation-only budgeting app that sets money aside into virtual pockets.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const userId = await getCurrentUserId();
  // Deterministic payroll catch-up on every money-page load (idempotent).
  await ensurePayrollCurrent(userId);
  const unreadCount = await getUnreadNotificationCount(userId);
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
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-3">
              <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/30">
                  S
                </span>
                <span>SetAside</span>
                <span className="badge hidden bg-slate-100 text-muted sm:inline-flex">Simulation</span>
              </Link>
              <NavLinks unreadCount={unreadCount} />
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 outline-none">
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
