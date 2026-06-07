import { formatCents } from "@/domain/money";
import type { PocketStatus } from "@/domain/types";

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={className}>{formatCents(cents)}</span>;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-brand-50 text-brand-700",
  fully_funded: "bg-emerald-50 text-positive",
  paused: "bg-amber-50 text-warn",
  purchased: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-600",
  draft: "bg-slate-100 text-slate-600",
  archived: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  fully_funded: "Fully funded",
  paused: "Paused",
  purchased: "Purchased",
  cancelled: "Cancelled",
  draft: "Draft",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: PocketStatus | string }) {
  return (
    <span className={`badge ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function ProgressBar({
  currentCents,
  targetCents,
}: {
  currentCents: number;
  targetCents: number | null;
}) {
  const pct =
    targetCents && targetCents > 0
      ? Math.min(100, Math.round((currentCents / targetCents) * 100))
      : 0;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-positive" : "bg-brand-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{formatCents(currentCents)}</span>
        <span>{targetCents ? `${pct}% of ${formatCents(targetCents)}` : "No goal set"}</span>
      </div>
    </div>
  );
}
