"use client";

import { FormDialog } from "./Dialog";
import { ConfirmButton } from "./ConfirmButton";
import {
  cancelAction,
  purchaseAction,
  setAsideAction,
  setPocketStatusAction,
  transferAction,
  updatePocketAction,
} from "@/app/actions";
import { formatCents } from "@/domain/money";
import type { PocketStatus } from "@/domain/types";
import type { TransferTargets } from "@/server/queries";

export function PocketActions({
  pocketId,
  name,
  status,
  isOverflow,
  currentBalanceCents,
  targetAmountCents,
  targetBuyDate,
  lockUntilDate,
  transferTargets,
}: {
  pocketId: string;
  name: string;
  status: PocketStatus;
  isOverflow: boolean;
  currentBalanceCents: number;
  targetAmountCents: number | null;
  targetBuyDate: string | null;
  lockUntilDate: string | null;
  transferTargets: TransferTargets;
}) {
  const live = status === "active" || status === "paused" || status === "fully_funded";
  if (!live) return null;

  const small = "px-3 py-1.5 text-xs";
  const otherPockets = transferTargets.pockets.filter((p) => p.id !== pocketId);

  return (
    <div className="flex flex-wrap gap-2">
      {status === "active" && (
        <FormDialog
          triggerLabel="Set aside"
          triggerClassName={`btn-secondary ${small}`}
          title={`Set money aside — ${name}`}
          submitLabel="Set aside"
          action={setAsideAction}
          hidden={{ pocketId }}
        >
          <p className="text-sm text-muted">
            Moves money from Free to Spend into this pocket. Your Main Account balance does not
            change.
          </p>
          <div>
            <label className="label">Amount</label>
            <input
              name="amount"
              aria-label="Amount to set aside"
              inputMode="decimal"
              placeholder="$0.00"
              className="input"
              autoFocus
            />
          </div>
        </FormDialog>
      )}

      {currentBalanceCents > 0 && (
        <FormDialog
          triggerLabel="Transfer"
          triggerClassName={`btn-secondary ${small}`}
          title={`Transfer from ${name}`}
          submitLabel="Transfer"
          action={transferAction}
          hidden={{ pocketId }}
        >
          <p className="text-sm text-muted">
            Move set-aside money somewhere else. Sending it to a category auto-distributes it across
            that category&apos;s pockets. Holds {formatCents(currentBalanceCents)}.
          </p>
          <div>
            <label className="label">Amount</label>
            <input
              name="amount"
              aria-label="Amount to transfer"
              inputMode="decimal"
              defaultValue={(currentBalanceCents / 100).toFixed(2)}
              className="input"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Destination</label>
            <select name="destination" aria-label="Transfer destination" className="input" defaultValue="">
              <option value="" disabled>
                Choose a destination…
              </option>
              <option value="free_to_spend">Free to Spend</option>
              {otherPockets.length > 0 && (
                <optgroup label="Pockets">
                  {otherPockets.map((p) => (
                    <option key={p.id} value={`pocket:${p.id}`}>
                      {p.categoryName} · {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {transferTargets.categories.length > 0 && (
                <optgroup label="Categories (auto-distribute)">
                  {transferTargets.categories.map((c) => (
                    <option key={c.id} value={`category:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </FormDialog>
      )}

      {!isOverflow && (
        <FormDialog
          triggerLabel="Mark as bought"
          triggerClassName={`btn-secondary ${small}`}
          title={`Mark as bought — ${name}`}
          submitLabel="Confirm purchase"
          action={purchaseAction}
          hidden={{ pocketId }}
        >
          <p className="text-sm text-muted">
            This pocket holds {formatCents(currentBalanceCents)}. Recording a purchase reduces your
            Main Account balance. Any leftover returns to Free to Spend.
          </p>
          <div>
            <label className="label">Purchase amount</label>
            <input
              name="amount"
              aria-label="Purchase amount"
              inputMode="decimal"
              defaultValue={(currentBalanceCents / 100).toFixed(2)}
              className="input"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input name="note" aria-label="Purchase note" className="input" placeholder="What did you buy?" />
          </div>
        </FormDialog>
      )}

      {!isOverflow && (
        <FormDialog
          triggerLabel="Edit"
          triggerClassName={`btn-ghost ${small}`}
          title={`Edit ${name}`}
          submitLabel="Save changes"
          action={updatePocketAction}
          hidden={{ pocketId }}
        >
          <div>
            <label className="label">Name</label>
            <input name="name" aria-label="Pocket name" className="input" defaultValue={name} autoFocus />
          </div>
          <div>
            <label className="label">Goal amount</label>
            <input
              name="target"
              aria-label="Goal amount"
              inputMode="decimal"
              placeholder="$0.00 (no goal)"
              className="input"
              defaultValue={targetAmountCents != null ? (targetAmountCents / 100).toFixed(2) : ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Target buy date</label>
              <input
                type="date"
                name="targetBuyDate"
                aria-label="Target buy date"
                className="input"
                defaultValue={targetBuyDate ?? ""}
              />
            </div>
            <div>
              <label className="label">Lock until</label>
              <input
                type="date"
                name="lockUntilDate"
                aria-label="Lock until date"
                className="input"
                defaultValue={lockUntilDate ?? ""}
              />
            </div>
          </div>
        </FormDialog>
      )}

      {!isOverflow && status === "paused" && (
        <ConfirmButton
          label="Resume"
          className={`btn-ghost ${small}`}
          action={setPocketStatusAction}
          hidden={{ pocketId, status: "active" }}
        />
      )}
      {!isOverflow && (status === "active" || status === "fully_funded") && (
        <ConfirmButton
          label="Pause"
          className={`btn-ghost ${small}`}
          action={setPocketStatusAction}
          hidden={{ pocketId, status: "paused" }}
        />
      )}

      {!isOverflow && (
        <ConfirmButton
          label="Cancel goal"
          className={`btn-ghost ${small}`}
          confirmText={`Cancel "${name}" and return ${formatCents(currentBalanceCents)} to Free to Spend?`}
          action={cancelAction}
          hidden={{ pocketId }}
        />
      )}
    </div>
  );
}
