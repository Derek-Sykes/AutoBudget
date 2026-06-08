import Link from "next/link";
import { requireCurrentUserId } from "@/server/currentUser";
import {
  getActivePockets,
  getDashboardData,
  getIncomeSummary,
  getRecentPurchases,
} from "@/server/queries";
import { AddMoneyDialog } from "@/components/AddMoneyDialog";
import { CreateCategoryButton, CreatePocketButton } from "@/components/CatalogButtons";
import { BalanceSummary } from "@/components/BalanceSummary";
import { IncomeCard } from "@/components/IncomeCard";
import { ProgressBar } from "@/components/Bits";
import { ArrowRightIcon } from "@/components/icons";
import { formatCents } from "@/domain/money";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await requireCurrentUserId();
  const [{ balances, categories }, activePockets, recentPurchases, incomeSummary] =
    await Promise.all([
      getDashboardData(userId),
      getActivePockets(userId),
      getRecentPurchases(userId),
      getIncomeSummary(userId),
    ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted">Give every dollar a job before you spend it.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateCategoryButton />
          <CreatePocketButton categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
          <AddMoneyDialog activePockets={activePockets} recentPurchases={recentPurchases} />
        </div>
      </div>

      <BalanceSummary balances={balances} />

      <IncomeCard summary={incomeSummary} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Categories</h2>
          <span className="text-sm text-muted">
            {categories.length} {categories.length === 1 ? "group" : "groups"}
          </span>
        </div>

        {categories.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-muted">No categories yet.</p>
            <CreateCategoryButton className="btn-primary" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => {
              const pct =
                c.targetTotalCents > 0
                  ? Math.min(100, Math.round((c.setAsideCents / c.targetTotalCents) * 100))
                  : 0;
              return (
                <Link key={c.id} href={`/categories/${c.id}`} className="card-interactive group">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 font-semibold text-brand-700"
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                      <h3 className="font-semibold">{c.name}</h3>
                    </div>
                    <ArrowRightIcon className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
                  </div>
                  <p className="mb-3 text-sm text-muted">
                    <span className="font-medium text-ink">{formatCents(c.setAsideCents)}</span> set
                    aside{c.targetTotalCents > 0 ? ` of ${formatCents(c.targetTotalCents)}` : ""}
                  </p>
                  <ProgressBar currentCents={c.setAsideCents} targetCents={c.targetTotalCents || null} />
                  <div className="mt-3 flex gap-2 text-xs text-muted">
                    <span className="badge bg-slate-100 text-slate-600">{c.activeCount} active</span>
                    {c.fullyFundedCount > 0 && (
                      <span className="badge bg-emerald-50 text-positive">
                        {c.fullyFundedCount} funded
                      </span>
                    )}
                    {pct >= 100 && c.targetTotalCents > 0 && (
                      <span className="badge bg-brand-50 text-brand-700">On track</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
