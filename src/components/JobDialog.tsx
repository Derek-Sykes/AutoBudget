"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Overlay, SubmitButton } from "./Dialog";
import { createJobAction, updateJobAction, type ActionState } from "@/app/actions";
import type { JobView } from "@/server/queries";
import type { PayFrequency } from "@/domain/types";

const FREQUENCIES: { value: PayFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks (biweekly)" },
  { value: "semimonthly", label: "Twice a month (semi-monthly)" },
  { value: "monthly", label: "Monthly" },
];

export function JobDialog({
  mode,
  job,
  triggerLabel,
  triggerClassName = "btn-secondary",
}: {
  mode: "create" | "edit";
  job?: JobView;
  triggerLabel: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);
  return (
    <>
      <button
        className={triggerClassName}
        onClick={() => {
          setInstance((n) => n + 1);
          setOpen(true);
        }}
      >
        {triggerLabel}
      </button>
      {open && (
        <Overlay
          title={mode === "create" ? "Add income source" : `Edit ${job?.name ?? "job"}`}
          onClose={() => setOpen(false)}
        >
          <Body key={instance} mode={mode} job={job} onSuccess={() => setOpen(false)} />
        </Overlay>
      )}
    </>
  );
}

function Body({
  mode,
  job,
  onSuccess,
}: {
  mode: "create" | "edit";
  job?: JobView;
  onSuccess: () => void;
}) {
  const action = mode === "create" ? createJobAction : updateJobAction;
  const [state, formAction] = useActionState(action, { ok: false } as ActionState);
  const [frequency, setFrequency] = useState<PayFrequency>(job?.payFrequency ?? "biweekly");

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && job && <input type="hidden" name="jobId" value={job.id} />}

      <div>
        <label className="label">Job / income name</label>
        <input
          name="name"
          aria-label="Job or income name"
          className="input"
          placeholder="e.g. Day job"
          defaultValue={job?.name ?? ""}
          autoFocus
        />
      </div>

      <div>
        <label className="label">After-tax paycheck amount</label>
        <input
          name="amount"
          aria-label="After-tax paycheck amount"
          inputMode="decimal"
          className="input"
          placeholder="$0.00"
          defaultValue={job ? (job.amountCents / 100).toFixed(2) : ""}
        />
        <p className="mt-1 text-xs text-muted">Net pay you actually receive, not gross salary.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Pay schedule</label>
          <select
            name="payFrequency"
            aria-label="Pay schedule"
            className="input"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as PayFrequency)}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">First pay date</label>
          <input
            type="date"
            name="firstPayDate"
            aria-label="First pay date"
            className="input"
            defaultValue={job?.firstPayDate ?? ""}
          />
        </div>
      </div>

      {frequency === "semimonthly" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">First day of month</label>
            <input
              name="semiMonthlyDay1"
              aria-label="First pay day of month"
              inputMode="numeric"
              className="input"
              placeholder="1"
              defaultValue={job?.semiMonthlyDay1 ?? 1}
            />
          </div>
          <div>
            <label className="label">Second day of month</label>
            <input
              name="semiMonthlyDay2"
              aria-label="Second pay day of month"
              inputMode="numeric"
              className="input"
              placeholder="15"
              defaultValue={job?.semiMonthlyDay2 ?? 15}
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoDisperse" defaultChecked={job ? job.autoDisperse : true} />
        Auto-disperse paychecks through my funding plan
      </label>
      <p className="-mt-2 text-xs text-muted">
        Off means each paycheck lands entirely in Free to Spend.
      </p>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="flex justify-end">
        <SubmitButton label={mode === "create" ? "Add job" : "Save changes"} />
      </div>
    </form>
  );
}
