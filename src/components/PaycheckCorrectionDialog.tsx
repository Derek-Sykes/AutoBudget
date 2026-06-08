"use client";

import { correctPaycheckAction } from "@/app/actions";
import { formatCents } from "@/domain/money";
import { FormDialog } from "./Dialog";

export function PaycheckCorrectionDialog({
  batchId,
  note,
  originalAmountCents,
  currentAmountCents,
  isPayrollGenerated,
}: {
  batchId: string;
  note: string | null;
  originalAmountCents: number;
  currentAmountCents: number;
  isPayrollGenerated: boolean;
}) {
  return (
    <FormDialog
      triggerLabel="Adjust paycheck"
      triggerClassName="btn-secondary px-3 py-1.5 text-xs"
      title="Correct paycheck amount"
      submitLabel="Create correction"
      action={correctPaycheckAction}
      hidden={{ batchId }}
    >
      <div className="space-y-3 text-sm">
        {note && <p className="font-medium">{note}</p>}
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Original amount</span>
            <span className="font-semibold tabular-nums">{formatCents(originalAmountCents)}</span>
          </div>
          {currentAmountCents !== originalAmountCents && (
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-muted">Current recorded amount</span>
              <span className="font-semibold tabular-nums">{formatCents(currentAmountCents)}</span>
            </div>
          )}
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Corrected amount</span>
          <input
            name="correctedAmount"
            inputMode="decimal"
            defaultValue={(currentAmountCents / 100).toFixed(2)}
            className="input"
            autoFocus
          />
        </label>
        {isPayrollGenerated && (
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3">
            <input name="updateFutureJobAmount" type="checkbox" className="mt-1" />
            <span>
              Also update this job&apos;s future paycheck amount
              <span className="block text-xs text-muted">
                This only changes future generated paychecks. Existing history stays intact.
              </span>
            </span>
          </label>
        )}
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          This creates a correction ledger entry. It does not delete or rewrite the original
          paycheck history.
        </p>
      </div>
    </FormDialog>
  );
}
