import Link from "next/link";
import { formatCents } from "@/domain/money";
import { WalletIcon } from "./icons";
import type { IncomeSummary } from "@/server/queries";

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function relativeDays(iso: string): string {
  const day = 86_400_000;
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = Math.round((target - today) / day);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff} days`;
}

export function IncomeCard({ summary }: { summary: IncomeSummary }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <WalletIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm text-muted">Next paycheck</p>
          {summary.nextPaycheck ? (
            <>
              <p className="text-lg font-semibold tabular-nums">
                {formatCents(summary.nextPaycheck.amountCents)}{" "}
                <span className="font-normal text-muted">· {summary.nextPaycheck.jobName}</span>
              </p>
              <p className="text-sm text-muted">
                {fmtDate(summary.nextPaycheck.dateISO)} ({relativeDays(summary.nextPaycheck.dateISO)})
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              No active income sources.{" "}
              <Link href="/jobs" className="font-medium text-brand-600 hover:underline">
                Add a job
              </Link>
            </p>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm text-muted">Est. monthly income</p>
        <p className="text-2xl font-bold tabular-nums">{formatCents(summary.monthlyIncomeCents)}</p>
        <Link href="/jobs" className="text-xs font-medium text-brand-600 hover:underline">
          Manage jobs →
        </Link>
      </div>
    </div>
  );
}
