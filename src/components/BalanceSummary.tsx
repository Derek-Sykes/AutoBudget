import { formatCents } from "@/domain/money";
import { LockIcon, SparklesIcon, WalletIcon } from "./icons";
import type { DashboardBalances } from "@/server/services/balanceService";

function Figure({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-lg p-3 sm:flex-1 sm:p-4 ${
        highlight ? "bg-brand-50 ring-1 ring-inset ring-brand-100" : ""
      }`}
    >
      <div className="mb-1 flex items-center gap-2 text-sm text-muted">
        <span className={highlight ? "text-brand-600" : "text-slate-400"}>{icon}</span>
        {label}
      </div>
      <div
        className={`break-words text-xl font-bold tabular-nums sm:text-3xl ${
          highlight ? "text-brand-700" : "text-ink"
        }`}
      >
        {formatCents(value)}
      </div>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden items-center justify-center px-1 text-2xl font-light text-slate-500 sm:flex">
      {children}
    </div>
  );
}

export function BalanceSummary({ balances }: { balances: DashboardBalances }) {
  return (
    <div className="card grid gap-2 sm:flex sm:flex-wrap sm:items-stretch">
      <Figure
        icon={<WalletIcon className="h-4 w-4" />}
        label="Main Account"
        value={balances.mainAccountBalanceCents}
        sub="Simulated balance"
      />
      <Op>−</Op>
      <Figure
        icon={<LockIcon className="h-4 w-4" />}
        label="Set Aside"
        value={balances.setAsideCents}
        sub="Committed to pockets"
      />
      <Op>=</Op>
      <Figure
        icon={<SparklesIcon className="h-4 w-4" />}
        label="Free to Spend"
        value={balances.freeToSpendCents}
        sub="Truly free, guilt-free"
        highlight
      />
    </div>
  );
}
