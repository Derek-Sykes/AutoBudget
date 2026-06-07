"use client";

import { useActionState, useEffect, useState } from "react";
import { Overlay, SubmitButton } from "./Dialog";
import {
  addPaybackAction,
  addPaycheckAction,
  manualAdjustAction,
  previewPaycheckAction,
  type ActionState,
} from "@/app/actions";
import { formatCents } from "@/domain/money";
import { PlusIcon } from "./icons";

type Tab = "paycheck" | "payback" | "adjustment";
type PaybackMode = "free_to_spend" | "pocket" | "link";

interface Preview {
  allocations: { pocketId: string; pocketName: string; amountCents: number }[];
  freeToSpendCents: number;
  totalSetAsideCents: number;
  hasActivePlan: boolean;
}

export function AddMoneyDialog({
  activePockets,
  recentPurchases,
}: {
  activePockets: { id: string; name: string }[];
  recentPurchases: { id: string; note: string | null; amountCents: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);
  return (
    <>
      <button
        className="btn-primary"
        onClick={() => {
          setInstance((n) => n + 1);
          setOpen(true);
        }}
      >
        <PlusIcon className="h-4 w-4" /> Add money
      </button>
      {open && (
        <Overlay title="Add money" onClose={() => setOpen(false)}>
          <Body
            key={instance}
            activePockets={activePockets}
            recentPurchases={recentPurchases}
            onSuccess={() => setOpen(false)}
          />
        </Overlay>
      )}
    </>
  );
}

function Body({
  activePockets,
  recentPurchases,
  onSuccess,
}: {
  activePockets: { id: string; name: string }[];
  recentPurchases: { id: string; note: string | null; amountCents: number }[];
  onSuccess: () => void;
}) {
  const [tab, setTab] = useState<Tab>("paycheck");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Paycheck state
  const [amount, setAmount] = useState("");
  const [autoDisperse, setAutoDisperse] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | undefined>();
  const [previewing, setPreviewing] = useState(false);

  const [pcState, pcAction] = useActionState(addPaycheckAction, { ok: false } as ActionState);
  const [pbState, pbAction] = useActionState(addPaybackAction, { ok: false } as ActionState);
  const [adjState, adjAction] = useActionState(manualAdjustAction, { ok: false } as ActionState);

  // Payback state
  const [paybackMode, setPaybackMode] = useState<PaybackMode>("free_to_spend");

  useEffect(() => {
    if (pcState.ok || pbState.ok || adjState.ok) onSuccess();
  }, [pcState, pbState, adjState, onSuccess]);

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(undefined);
    const res = await previewPaycheckAction(amount, autoDisperse);
    setPreviewing(false);
    if (res.ok && res.preview) setPreview(res.preview as Preview);
    else {
      setPreview(null);
      setPreviewError(res.error);
    }
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-xs sm:text-sm">
        <button
          type="button"
          aria-pressed={tab === "paycheck"}
          className={`rounded-md py-1.5 font-medium transition ${tab === "paycheck" ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}
          onClick={() => setTab("paycheck")}
        >
          Paycheck
        </button>
        <button
          type="button"
          aria-pressed={tab === "payback"}
          className={`rounded-md py-1.5 font-medium transition ${tab === "payback" ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}
          onClick={() => setTab("payback")}
        >
          Payback
        </button>
        <button
          type="button"
          aria-pressed={tab === "adjustment"}
          className={`rounded-md py-1.5 font-medium transition ${tab === "adjustment" ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}
          onClick={() => setTab("adjustment")}
        >
          Adjustment
        </button>
      </div>

      {tab === "paycheck" && (
        <form action={pcAction} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="autoDisperse" value={autoDisperse ? "true" : "false"} />
          <p className="text-sm text-muted">
            New money. Increases your Main Account balance and, if auto-disperse is on, runs your
            funding plan.
          </p>
          <div>
            <label className="label">Amount</label>
            <input
              name="amount"
              aria-label="Paycheck amount"
              inputMode="decimal"
              placeholder="$1,000.00"
              className="input"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setPreview(null);
              }}
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoDisperse}
              onChange={(e) => {
                setAutoDisperse(e.target.checked);
                setPreview(null);
              }}
            />
            Auto-disperse through my funding plan
          </label>
          <div>
            <label className="label">Note (optional)</label>
            <input
              name="note"
              aria-label="Note"
              className="input"
              placeholder="e.g. Biweekly paycheck"
            />
          </div>

          {autoDisperse && (
            <button type="button" className="btn-secondary w-full" onClick={runPreview} disabled={previewing}>
              {previewing ? "Calculating…" : "Preview allocation"}
            </button>
          )}
          {previewError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{previewError}</p>
          )}
          {preview && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
            >
              {!preview.hasActivePlan ? (
                <p className="text-muted">No active funding plan — all of it stays Free to Spend.</p>
              ) : (
                <>
                  <p className="mb-2 font-medium">Will set aside {formatCents(preview.totalSetAsideCents)}:</p>
                  <ul className="space-y-1">
                    {preview.allocations.map((a) => (
                      <li key={a.pocketId} className="flex justify-between">
                        <span className="text-muted">{a.pocketName}</span>
                        <span>{formatCents(a.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-medium">
                    <span>Stays Free to Spend</span>
                    <span>{formatCents(preview.freeToSpendCents)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {pcState.error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{pcState.error}</p>
          )}
          <div className="flex justify-end">
            <SubmitButton label="Add paycheck" />
          </div>
        </form>
      )}

      {tab === "payback" && (
        <form action={pbAction} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="transactionType" value={paybackMode === "link" ? "refund" : "payback"} />
          <input
            type="hidden"
            name="restoreMode"
            value={
              paybackMode === "free_to_spend"
                ? "free_to_spend"
                : paybackMode === "pocket"
                  ? "manual_destination"
                  : "exact_original_destinations"
            }
          />
          {paybackMode === "pocket" && (
            <input type="hidden" name="manualDestinationType" value="pocket" />
          )}
          <p className="text-sm text-muted">
            Money returning from a refund or reimbursement. This never auto-disperses.
          </p>
          <div>
            <label className="label">Amount</label>
            <input
              name="amount"
              aria-label="Payback amount"
              inputMode="decimal"
              placeholder="$0.00"
              className="input"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Where should it go?</label>
            <select
              className="input"
              aria-label="Where should it go?"
              value={paybackMode}
              onChange={(e) => setPaybackMode(e.target.value as PaybackMode)}
            >
              <option value="free_to_spend">Return to Free to Spend</option>
              <option value="pocket">Add to a specific pocket</option>
              <option value="link" disabled={recentPurchases.length === 0}>
                Restore a recent purchase
              </option>
            </select>
          </div>
          {paybackMode === "pocket" && (
            <div>
              <label className="label">Pocket</label>
              <select
                name="manualDestinationId"
                aria-label="Destination pocket"
                className="input"
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a pocket…
                </option>
                {activePockets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {paybackMode === "link" && (
            <div>
              <label className="label">Original purchase</label>
              <select
                name="linkedBatchId"
                aria-label="Original purchase to restore"
                className="input"
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a purchase…
                </option>
                {recentPurchases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.note || "Purchase") + " — " + formatCents(p.amountCents)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Note (optional)</label>
            <input
              name="note"
              aria-label="Note"
              className="input"
              placeholder="e.g. Friend paid me back"
            />
          </div>
          {pbState.error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{pbState.error}</p>
          )}
          <div className="flex justify-end">
            <SubmitButton label="Add payback" />
          </div>
        </form>
      )}

      {tab === "adjustment" && (
        <form action={adjAction} className="space-y-4">
          <p className="text-sm text-muted">
            Correct your simulated balance (e.g. a fee or a forgotten deposit). This never
            auto-disperses and a note is required.
          </p>
          <div>
            <label className="label">Direction</label>
            <select
              name="direction"
              aria-label="Adjustment direction"
              className="input"
              defaultValue="increase"
            >
              <option value="increase">Increase balance</option>
              <option value="decrease">Decrease balance</option>
            </select>
          </div>
          <div>
            <label className="label">Amount</label>
            <input
              name="amount"
              aria-label="Adjustment amount"
              inputMode="decimal"
              placeholder="$0.00"
              className="input"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Note (required)</label>
            <input
              name="note"
              aria-label="Adjustment note"
              className="input"
              placeholder="Why are you adjusting?"
              required
            />
          </div>
          {adjState.error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{adjState.error}</p>
          )}
          <div className="flex justify-end">
            <SubmitButton label="Apply adjustment" />
          </div>
        </form>
      )}
    </div>
  );
}
