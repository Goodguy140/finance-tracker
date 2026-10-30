"use client";

import { markTransactionsReviewedAction } from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";

/**
 * "Needs review (N)" for a log of entries nobody typed in (file imports, recurring auto-posts,
 * API posts): a toggle that shows only those, and while on, "Mark N shown as reviewed". Shared
 * by the Expense Log and the Income card; nothing shows when no entry needs a look.
 */
export function NeedsReviewFilter({
  reviewCount,
  reviewOnly,
  onToggle,
  shownIds,
  onMarked,
}: {
  reviewCount: number;
  reviewOnly: boolean;
  onToggle: () => void;
  /** The entries on screen with the filter on: what "Mark N shown" marks. */
  shownIds: string[];
  onMarked: (changed: number) => void;
}) {
  if (reviewCount === 0 && !reviewOnly) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={reviewOnly}
        data-testid="needs-review-filter"
        onClick={onToggle}
        className={`touch-manipulation rounded-full border px-3 py-1 text-xs font-medium transition ${
          reviewOnly
            ? "border-amber-400/60 bg-amber-500/20 text-amber-100"
            : "border-slate-700 bg-slate-900/60 text-amber-200 hover:bg-slate-800"
        }`}
      >
        Needs review ({reviewCount})
      </button>
      {reviewOnly && reviewCount > 0 ? (
        <ServerActionForm action={markTransactionsReviewedAction} onSuccess={(result) => onMarked(result.changed)}>
          <input type="hidden" name="transactionIdsJson" value={JSON.stringify(shownIds)} />
          <button type="submit" className="text-xs text-sky-300 hover:text-sky-200">
            Mark {shownIds.length} shown as reviewed
          </button>
        </ServerActionForm>
      ) : null}
    </div>
  );
}
