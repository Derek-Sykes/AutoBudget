import { getCurrentUserId } from "@/server/currentUser";
import { getActivityFeed } from "@/server/queries";
import { ConfirmButton } from "@/components/ConfirmButton";
import {
  clearNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  reverseAction,
} from "@/app/actions";
import { formatCents } from "@/domain/money";

export const dynamic = "force-dynamic";

const BATCH_LABELS: Record<string, string> = {
  PAYCHECK_DEPOSIT: "Paycheck deposit",
  PAYBACK_RESTORE: "Payback / refund",
  MANUAL_SET_ASIDE: "Set aside",
  MANUAL_REALLOCATION: "Reallocation",
  PURCHASE: "Purchase",
  CANCEL_GOAL: "Cancelled goal",
  MANUAL_ADJUSTMENT: "Manual adjustment",
};

function when(d: Date) {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ActivityPage() {
  const userId = await getCurrentUserId();
  const { logs, notifications, reversibleBatches } = await getActivityFeed(userId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-sm text-muted">Every balance change is explainable and reversible.</p>
      </div>

      {notifications.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Notifications</h2>
            {notifications.some((n) => !n.readAt) && (
              <form action={markAllNotificationsReadAction}>
                <button className="btn-ghost px-2.5 py-1 text-xs">Mark all read</button>
              </form>
            )}
          </div>
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`card flex items-start gap-3 ${
                  n.readAt ? "" : "border-brand-200 bg-brand-50"
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    n.readAt ? "bg-slate-300" : "bg-brand-500"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{n.title}</span>
                    <span className="shrink-0 text-xs text-muted">{when(n.createdAt)}</span>
                  </div>
                  <p className="text-sm text-muted">{n.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!n.readAt && (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        aria-label="Mark notification read"
                      >
                        Read
                      </button>
                    </form>
                  )}
                  <form action={clearNotificationAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button className="btn-ghost px-2 py-1 text-xs" title="Clear" aria-label="Clear">
                      ✕
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Undo a recent action</h2>
        <p className="text-sm text-muted">
          Reversal creates an opposite ledger entry. It is blocked if the money was already spent or
          the action was already reversed.
        </p>
        {reversibleBatches.length === 0 ? (
          <div className="card text-muted">Nothing to reverse yet.</div>
        ) : (
          <div className="space-y-2">
            {reversibleBatches.map((b) => (
              <div key={b.id} className="card flex items-center justify-between">
                <div>
                  <span className="font-medium">{BATCH_LABELS[b.batchType] ?? b.batchType}</span>
                  {b.note && <span className="text-sm text-muted"> — {b.note}</span>}
                  <div className="text-xs text-muted">{when(b.createdAt)}</div>
                </div>
                <ConfirmButton
                  label="Reverse"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  confirmText="Reverse this action? This creates an opposite ledger entry."
                  action={reverseAction}
                  hidden={{ batchId: b.id }}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        <div className="card divide-y divide-slate-100 p-0">
          {logs.length === 0 ? (
            <p className="p-5 text-muted">No activity yet.</p>
          ) : (
            logs.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{l.message ?? l.type}</p>
                  <p className="text-xs text-muted">{when(l.createdAt)}</p>
                </div>
                {l.amountCents != null && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatCents(l.amountCents)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
