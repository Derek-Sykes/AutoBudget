"use client";

import { useMemo, useState, useTransition } from "react";
import { saveFundingPlanAction } from "@/app/actions";
import {
  bpToPctString,
  distributeEvenlyBp,
  pctStringToBp,
  validatePlanWeights,
  type PlanWeightsInput,
} from "@/domain/fundingPlan";
import type { FundingPlanEditorData } from "@/server/services/fundingPlanService";

interface PocketState {
  pocketId: string;
  name: string;
  weight: string;
}
interface CategoryState {
  categoryId: string;
  name: string;
  weight: string;
  pockets: PocketState[];
}

function fmtBp(bp: number) {
  return `${(bp / 100).toFixed(2)}%`;
}

export function FundingPlanEditor({ data }: { data: FundingPlanEditorData }) {
  const [freeToSpend, setFreeToSpend] = useState(bpToPctString(data.freeToSpendBp));
  const [categories, setCategories] = useState<CategoryState[]>(
    data.categories.map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      weight: bpToPctString(c.weightBp),
      pockets: c.pockets.map((p) => ({
        pocketId: p.pocketId,
        name: p.name,
        weight: bpToPctString(p.weightBp),
      })),
    })),
  );
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Build the bp model + detect any unparseable field.
  const model = useMemo(() => {
    const ftsBp = pctStringToBp(freeToSpend);
    let anyInvalid = ftsBp === null;
    const cats = categories.map((c) => {
      const weightBp = pctStringToBp(c.weight);
      if (weightBp === null) anyInvalid = true;
      const pockets = c.pockets.map((p) => {
        const bp = pctStringToBp(p.weight);
        if (bp === null) anyInvalid = true;
        return { pocketId: p.pocketId, name: p.name, weightBp: bp ?? 0 };
      });
      return { categoryId: c.categoryId, name: c.name, weightBp: weightBp ?? 0, pockets };
    });
    const input: PlanWeightsInput = { freeToSpendBp: ftsBp ?? 0, categories: cats };
    return { input, anyInvalid };
  }, [freeToSpend, categories]);

  const validation = useMemo(() => validatePlanWeights(model.input), [model]);
  const topTotalBp = model.input.freeToSpendBp + model.input.categories.reduce((s, c) => s + c.weightBp, 0);
  const canSave = !model.anyInvalid && validation.valid && !pending;

  function setCategoryWeight(id: string, value: string) {
    setSaved(false);
    setCategories((cs) => cs.map((c) => (c.categoryId === id ? { ...c, weight: value } : c)));
  }
  function setPocketWeight(catId: string, pocketId: string, value: string) {
    setSaved(false);
    setCategories((cs) =>
      cs.map((c) =>
        c.categoryId === catId
          ? {
              ...c,
              pockets: c.pockets.map((p) =>
                p.pocketId === pocketId ? { ...p, weight: value } : p,
              ),
            }
          : c,
      ),
    );
  }
  function splitCategoryEvenly(catId: string) {
    setSaved(false);
    setCategories((cs) =>
      cs.map((c) => {
        if (c.categoryId !== catId) return c;
        const bps = distributeEvenlyBp(c.pockets.length);
        return { ...c, pockets: c.pockets.map((p, i) => ({ ...p, weight: bpToPctString(bps[i]) })) };
      }),
    );
  }
  function distributeTopEvenly() {
    setSaved(false);
    const bps = distributeEvenlyBp(categories.length + 1);
    setCategories((cs) => cs.map((c, i) => ({ ...c, weight: bpToPctString(bps[i]) })));
    setFreeToSpend(bpToPctString(bps[bps.length - 1]));
  }

  function onSave() {
    setSaveError(null);
    startTransition(async () => {
      const res = await saveFundingPlanAction(model.input);
      if (res.ok) setSaved(true);
      else setSaveError(res.error ?? "Could not save.");
    });
  }

  const remainingBp = 10000 - topTotalBp;

  return (
    <div className="space-y-5">
      <div className="card sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-sm text-muted">Categories + Free to Spend</span>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold tabular-nums ${
                topTotalBp === 10000 ? "text-positive" : "text-danger"
              }`}
            >
              {fmtBp(topTotalBp)}
            </span>
            {topTotalBp !== 10000 && (
              <span className="text-sm text-muted">
                {remainingBp > 0 ? `add ${fmtBp(remainingBp)}` : `${fmtBp(-remainingBp)} over`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost" onClick={distributeTopEvenly}>
            Distribute evenly
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={!canSave}>
            {pending ? "Saving…" : "Save plan"}
          </button>
        </div>
      </div>

      {saved && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-positive">
          Saved. New deposits will use these percentages.
        </p>
      )}
      {saveError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
          {saveError}
        </p>
      )}

      {/* Free to Spend share */}
      <div className="card flex items-center justify-between">
        <div>
          <p className="font-semibold">Free to Spend</p>
          <p className="text-sm text-muted">Share of each deposit left unallocated.</p>
        </div>
        <PercentInput
          value={freeToSpend}
          onChange={(v) => { setSaved(false); setFreeToSpend(v); }}
          ariaLabel="Free to Spend percentage"
        />
      </div>

      {categories.length === 0 && (
        <div className="card text-center text-muted">
          No active categories yet. Create categories and pockets first, then set their percentages.
        </div>
      )}

      {categories.map((c) => {
        const catBp = pctStringToBp(c.weight) ?? 0;
        const pocketTotalBp = c.pockets.reduce((s, p) => s + (pctStringToBp(p.weight) ?? 0), 0);
        const funded = catBp > 0;
        const overBp = pocketTotalBp > 10000;
        const overflowBp = Math.max(0, 10000 - pocketTotalBp);
        return (
          <div key={c.categoryId} className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{c.name}</p>
              <PercentInput
                value={c.weight}
                onChange={(v) => setCategoryWeight(c.categoryId, v)}
                ariaLabel={`${c.name} category percentage`}
              />
            </div>

            {c.pockets.length === 0 ? (
              <p className="text-sm text-warn">
                No active pockets — this category&apos;s share will go to Free to Spend.
              </p>
            ) : (
              <div className={`space-y-2 ${funded ? "" : "opacity-50"}`}>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>Split this category across its pockets</span>
                  <button
                    type="button"
                    className="text-brand-600 hover:underline"
                    onClick={() => splitCategoryEvenly(c.categoryId)}
                  >
                    Split evenly
                  </button>
                </div>
                {c.pockets.map((p) => (
                  <div key={p.pocketId} className="flex items-center justify-between">
                    <span className="text-sm">{p.name}</span>
                    <PercentInput
                      value={p.weight}
                      onChange={(v) => setPocketWeight(c.categoryId, p.pocketId, v)}
                      ariaLabel={`${p.name} percentage in ${c.name}`}
                    />
                  </div>
                ))}
                <div
                  className={`flex justify-between border-t border-slate-100 pt-2 text-sm ${
                    overBp ? "text-danger" : "text-muted"
                  }`}
                >
                  <span>Pockets total</span>
                  <span className="tabular-nums">{fmtBp(pocketTotalBp)}</span>
                </div>
                {overflowBp > 0 && (
                  <div className="flex justify-between text-xs text-muted">
                    <span>→ Overflow pocket</span>
                    <span className="tabular-nums">{fmtBp(overflowBp)}</span>
                  </div>
                )}
                {overBp && (
                  <p className="text-xs text-danger">Pocket percentages can&apos;t exceed 100%.</p>
                )}
                {!funded && (
                  <p className="text-xs text-muted">
                    This category is set to 0% — its pockets won&apos;t receive new money.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!validation.valid && !model.anyInvalid && (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-warn">
          {validation.errors.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      )}
      {model.anyInvalid && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-warn">
          Enter valid percentages (0–100, up to two decimals).
        </p>
      )}
    </div>
  );
}

function PercentInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-20 text-right"
        placeholder="0"
        aria-label={ariaLabel}
      />
      <span className="text-sm text-muted" aria-hidden="true">
        %
      </span>
    </div>
  );
}
