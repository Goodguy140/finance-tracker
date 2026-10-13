"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { reallocateBudgetAction } from "@/app/actions";
import { CurrencyAmountInput, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { headroomCents, overageCents, type ReallocationRow } from "@/lib/budget-reallocation";
import { formatCurrency } from "@/lib/money";

export type BudgetReallocateDialogProps = {
  /** The over-budget category the overage is covered for. */
  destination: ReallocationRow;
  /** Other budgets that can be pulled from. */
  candidates: ReallocationRow[];
  onClose: () => void;
  /** Called after the reallocation is saved (dialog can close). */
  onApplied: () => void;
};

/** Dollar string ("12.50") → integer cents, or 0 for blank/invalid input. */
function dollarsToCents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Pre-fill amounts to cover the overage, largest headroom first. */
function greedyPrefill(overage: number, sources: ReallocationRow[]): Record<string, string> {
  const amounts: Record<string, string> = {};
  let remaining = overage;
  for (const source of [...sources].sort((a, b) => headroomCents(b) - headroomCents(a))) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, headroomCents(source));
    if (take > 0) {
      amounts[source.categoryId] = centsToDollars(take);
      remaining -= take;
    }
  }
  return amounts;
}

export function BudgetReallocateDialog({
  destination,
  candidates,
  onClose,
  onApplied,
}: BudgetReallocateDialogProps) {
  const overage = overageCents(destination);

  const sources = useMemo(
    () =>
      candidates
        .filter((row) => row.categoryId !== destination.categoryId && headroomCents(row) > 0)
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
    [candidates, destination.categoryId],
  );

  const [amounts, setAmounts] = useState<Record<string, string>>(() => greedyPrefill(overage, sources));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const transfers = useMemo(
    () =>
      sources
        .map((source) => ({ categoryId: source.categoryId, amountCents: dollarsToCents(amounts[source.categoryId] ?? "") }))
        .filter((transfer) => transfer.amountCents > 0),
    [amounts, sources],
  );

  const allocatedCents = transfers.reduce((sum, transfer) => sum + transfer.amountCents, 0);
  const remainingCents = overage - allocatedCents;
  const overAllocated = allocatedCents > overage;
  const exceedsAnyHeadroom = transfers.some((transfer) => {
    const source = sources.find((row) => row.categoryId === transfer.categoryId);
    return source ? transfer.amountCents > headroomCents(source) : true;
  });
  const canApply = allocatedCents > 0 && !overAllocated && !exceedsAnyHeadroom;

  const setAmount = (categoryId: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [categoryId]: value }));
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/50 p-4">
      <button type="button" aria-label="Close" className="fixed inset-0 h-full w-full cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="budget-reallocate-title"
        className="relative mx-auto mt-10 mb-10 w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl sm:p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h4 id="budget-reallocate-title" className="text-lg font-semibold text-slate-100">
              Cover {destination.categoryName} overage
            </h4>
            <p className="mt-0.5 text-sm text-slate-400">
              {formatCurrency(destination.spentCents)} spent of {formatCurrency(destination.limitCents)} —{" "}
              <span className="font-medium text-red-300">{formatCurrency(overage)} over</span>
            </p>
          </div>
          <button type="button" className={secondaryBtnClass} onClick={onClose}>
            Close
          </button>
        </div>

        {sources.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
            No other budget has room to give. Adjust limits in{" "}
            <a href="/settings/categories" className="text-blue-300 underline-offset-4 hover:underline">
              Settings → Categories
            </a>
            .
          </p>
        ) : (
          <ServerActionForm action={reallocateBudgetAction} onSuccess={onApplied} className="space-y-3">
            <input type="hidden" name="destinationCategoryId" value={destination.categoryId} />
            <input type="hidden" name="transfers" value={JSON.stringify(transfers)} readOnly />

            <p className="text-xs text-slate-400">
              Take from these budgets to raise {destination.categoryName}&apos;s limit. Each is capped at its remaining
              room; you can cover part or all of the overage.
            </p>

            <ul className="space-y-2">
              {sources.map((source) => {
                const room = headroomCents(source);
                return (
                  <li
                    key={source.categoryId}
                    className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5"
                  >
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-200">{source.categoryName}</span>
                      <span className="text-xs text-slate-400">{formatCurrency(room)} available</span>
                    </div>
                    <CurrencyAmountInput
                      placeholder="0.00"
                      value={amounts[source.categoryId] ?? ""}
                      onChange={(event) => setAmount(source.categoryId, event.target.value)}
                    />
                  </li>
                );
              })}
            </ul>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Allocated</span>
                <span className="tabular-nums font-medium text-slate-100">{formatCurrency(allocatedCents)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-slate-400">{overAllocated ? "Over-allocated by" : "Remaining to cover"}</span>
                <span
                  className={`tabular-nums font-medium ${overAllocated ? "text-red-300" : remainingCents === 0 ? "text-emerald-300" : "text-slate-100"}`}
                >
                  {formatCurrency(Math.abs(remainingCents))}
                </span>
              </div>
            </div>

            {overAllocated ? (
              <p className="text-xs text-red-300">You can&apos;t transfer more than the {formatCurrency(overage)} overage.</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={secondaryBtnClass} onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className={`${primaryBtnClass} disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={!canApply}
              >
                Apply reallocation
              </button>
            </div>
          </ServerActionForm>
        )}
      </div>
    </div>,
    document.body,
  );
}
