"use client";

import { FormDialog } from "./Dialog";
import { createCategoryAction, createPocketAction } from "@/app/actions";
import { FolderPlusIcon, PlusIcon } from "./icons";
import { POCKET_TYPES } from "@/domain/types";

const TYPE_LABELS: Record<string, string> = {
  one_time_goal: "One-time goal",
  monthly_budget: "Monthly budget",
  recurring_bill: "Recurring bill",
  emergency_fund: "Emergency fund",
  investment_contribution: "Investment contribution",
  sinking_fund: "Sinking fund",
  free_to_spend: "Free to spend",
};

export function CreateCategoryButton({ className = "btn-secondary" }: { className?: string }) {
  return (
    <FormDialog
      triggerLabel={
        <>
          <FolderPlusIcon className="h-4 w-4" /> New category
        </>
      }
      triggerClassName={className}
      title="New category"
      submitLabel="Create category"
      action={createCategoryAction}
    >
      <div>
        <label className="label">Name</label>
        <input name="name" aria-label="Category name" className="input" placeholder="e.g. Travel" autoFocus />
      </div>
      <div>
        <label className="label">Description (optional)</label>
        <input
          name="description"
          aria-label="Category description"
          className="input"
          placeholder="What is this group for?"
        />
      </div>
    </FormDialog>
  );
}

export function CreatePocketButton({
  categoryId,
  categories,
  className = "btn-primary",
}: {
  categoryId?: string;
  categories?: { id: string; name: string }[];
  className?: string;
}) {
  return (
    <FormDialog
      triggerLabel={
        <>
          <PlusIcon className="h-4 w-4" /> New pocket
        </>
      }
      triggerClassName={className}
      title="New pocket"
      submitLabel="Create pocket"
      action={createPocketAction}
      hidden={categoryId ? { categoryId } : undefined}
    >
      {!categoryId && categories && (
        <div>
          <label className="label">Category</label>
          <select name="categoryId" aria-label="Category" className="input" defaultValue="">
            <option value="" disabled>
              Choose a category…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="label">Name</label>
        <input name="name" aria-label="Pocket name" className="input" placeholder="e.g. Spain trip" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Type</label>
          <select name="pocketType" aria-label="Pocket type" className="input" defaultValue="one_time_goal">
            {POCKET_TYPES.filter((t) => t !== "free_to_spend" && t !== "overflow").map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Goal amount</label>
          <input name="target" aria-label="Goal amount" inputMode="decimal" placeholder="$0.00" className="input" />
        </div>
      </div>
      <div>
        <label className="label">Status</label>
        <select name="status" aria-label="Pocket status" className="input" defaultValue="active">
          <option value="active">Active — counts toward your plan</option>
          <option value="draft">Draft — brainstorm only, no money</option>
        </select>
      </div>
    </FormDialog>
  );
}
