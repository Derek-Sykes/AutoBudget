import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentUserId } from "@/server/currentUser";
import { getCategoryDetail, getTransferTargets } from "@/server/queries";
import { CreatePocketButton } from "@/components/CatalogButtons";
import { PocketActions } from "@/components/PocketActions";
import { FormDialog } from "@/components/Dialog";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ProgressBar, StatusBadge } from "@/components/Bits";
import {
  archiveCategoryAction,
  setAsideToCategoryAction,
  setPocketStatusAction,
  updateCategoryAction,
} from "@/app/actions";
import { formatCents } from "@/domain/money";
import type { PocketView, TransferTargets } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireCurrentUserId();
  const [data, transferTargets] = await Promise.all([
    getCategoryDetail(userId, id),
    getTransferTargets(userId),
  ]);
  if (!data) notFound();

  const { category } = data;
  const isArchived = category.status === "archived";
  // Overflow first, then the rest of the live pockets.
  const live = category.pockets
    .filter((p) => ["active", "paused", "fully_funded"].includes(p.status))
    .sort((a, b) => Number(b.isOverflow) - Number(a.isOverflow));
  const closed = category.pockets.filter((p) =>
    ["purchased", "cancelled", "draft", "archived"].includes(p.status),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted hover:underline">
          ← Back to dashboard
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-lg font-semibold text-brand-700"
          >
            {category.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{category.name}</h1>
            {category.description && <p className="text-sm text-muted">{category.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isArchived ? (
            <span className="badge bg-slate-100 text-slate-600">Archived</span>
          ) : (
            <>
              <FormDialog
                triggerLabel="Set aside"
                triggerClassName="btn-primary"
                title={`Fund ${category.name}`}
                submitLabel="Set aside"
                action={setAsideToCategoryAction}
                hidden={{ categoryId: category.id }}
              >
                <p className="text-sm text-muted">
                  Moves money from Free to Spend into this category and auto-distributes it across
                  its pockets by your funding plan. Anything left over (or that doesn&apos;t fit) goes
                  to the Overflow pocket. Your Main Account balance doesn&apos;t change.
                </p>
                <div>
                  <label className="label">Amount</label>
                  <input
                    name="amount"
                    aria-label="Amount to set aside into this category"
                    inputMode="decimal"
                    placeholder="$0.00"
                    className="input"
                    autoFocus
                  />
                </div>
              </FormDialog>
              <FormDialog
                triggerLabel="Edit"
                triggerClassName="btn-secondary"
                title={`Edit ${category.name}`}
                submitLabel="Save changes"
                action={updateCategoryAction}
                hidden={{ categoryId: category.id }}
              >
                <div>
                  <label className="label">Name</label>
                  <input
                    name="name"
                    aria-label="Category name"
                    className="input"
                    defaultValue={category.name}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Description (optional)</label>
                  <input
                    name="description"
                    aria-label="Category description"
                    className="input"
                    defaultValue={category.description ?? ""}
                  />
                </div>
              </FormDialog>
              <ConfirmButton
                label="Archive"
                className="btn-ghost"
                confirmText={`Archive "${category.name}"? Its pockets must be empty first.`}
                action={archiveCategoryAction}
                hidden={{ categoryId: category.id }}
              />
              <CreatePocketButton categoryId={category.id} className="btn-secondary" />
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-muted">Set aside in this category</span>
          <span className="font-medium">
            {formatCents(category.setAsideCents)}
            {category.targetTotalCents > 0 ? ` of ${formatCents(category.targetTotalCents)}` : ""}
          </span>
        </div>
        <ProgressBar currentCents={category.setAsideCents} targetCents={category.targetTotalCents || null} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pockets</h2>
        {live.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-8 text-center text-muted">
            <p>{isArchived ? "This category is archived." : "No pockets here yet."}</p>
            {!isArchived && <CreatePocketButton categoryId={category.id} className="btn-primary" />}
          </div>
        ) : (
          live.map((p) => <PocketRow key={p.id} pocket={p} transferTargets={transferTargets} />)
        )}
      </section>

      {closed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">History</h2>
          {closed.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div className="opacity-70">
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-sm text-muted">{formatCents(p.currentBalanceCents)}</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                {["purchased", "cancelled", "draft"].includes(p.status) && (
                  <ConfirmButton
                    label="Archive"
                    className="btn-ghost px-2.5 py-1 text-xs"
                    action={setPocketStatusAction}
                    hidden={{ pocketId: p.id, status: "archived" }}
                  />
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function PocketRow({
  pocket,
  transferTargets,
}: {
  pocket: PocketView;
  transferTargets: TransferTargets;
}) {
  const accent = pocket.isOverflow
    ? "border-dashed border-amber-200"
    : pocket.status === "fully_funded"
      ? "border-emerald-200 bg-emerald-50/30"
      : "";
  return (
    <div className={`card ${accent}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{pocket.name}</h3>
          {pocket.isOverflow ? (
            <span className="badge bg-amber-50 text-warn">Catch-all</span>
          ) : (
            <StatusBadge status={pocket.status} />
          )}
        </div>
      </div>
      {pocket.isOverflow ? (
        <p className="mb-3 text-sm text-muted">
          Holds {formatCents(pocket.currentBalanceCents)} — money this category couldn&apos;t place
          in other pockets. Transfer it wherever you like.
        </p>
      ) : (
        <div className="mb-3">
          <ProgressBar
            currentCents={pocket.currentBalanceCents}
            targetCents={pocket.targetAmountCents}
          />
        </div>
      )}
      <PocketActions
        pocketId={pocket.id}
        name={pocket.name}
        status={pocket.status}
        isOverflow={pocket.isOverflow}
        currentBalanceCents={pocket.currentBalanceCents}
        targetAmountCents={pocket.targetAmountCents}
        targetBuyDate={pocket.targetBuyDate}
        lockUntilDate={pocket.lockUntilDate}
        transferTargets={transferTargets}
      />
    </div>
  );
}
