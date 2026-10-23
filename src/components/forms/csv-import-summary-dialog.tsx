"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import type { CsvImportSummary } from "@/lib/csv-import";
import { formatCurrency } from "@/lib/money";
import { primaryBtnClass } from "./shared";

/** Rows listed per section; a long statement's tail is summarised as a count. */
const LISTED_ROWS = 50;

/** What a CSV import booked and what it left out, shown in the page once it finishes. */
export function CsvImportSummaryDialog({ summary, onClose }: { summary: CsvImportSummary; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  const { imported, unreadableDates, duplicates, unreadableAmounts } = summary;
  const income = summary.income ?? 0;
  const expenses = imported - income;
  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-slate-950/80 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-slate-100">
          Imported {expenses} {expenses === 1 ? "expense" : "expenses"}
          {income > 0 ? ` and ${income} income ${income === 1 ? "entry" : "entries"}` : ""}
        </h2>
        {unreadableDates.length === 0 && duplicates.length === 0 && unreadableAmounts === 0 ? (
          <p className="text-sm text-slate-300">Every row in the file was imported.</p>
        ) : null}

        {unreadableDates.length > 0 ? (
          <section className="space-y-2" data-testid="csv-import-unreadable-dates">
            <h3 className="text-sm font-medium text-amber-200">
              {unreadableDates.length} skipped: date could not be read
            </h3>
            <p className="text-xs text-slate-400">Fix the date in the file, or set a manual date, and import these again.</p>
            <ul className="space-y-1 text-xs text-slate-300">
              {unreadableDates.slice(0, LISTED_ROWS).map((entry) => (
                <li key={`${entry.field}-${entry.row}`}>
                  Row {entry.row}
                  {entry.title ? ` · ${entry.title}` : ""} ·{" "}
                  {entry.field === "postedDate" ? "posted date" : "date"}{" "}
                  {entry.value ? <code className="text-slate-200">“{entry.value}”</code> : "is empty"}
                </li>
              ))}
            </ul>
            <MoreRows total={unreadableDates.length} />
          </section>
        ) : null}

        {duplicates.length > 0 ? (
          <section className="space-y-2" data-testid="csv-import-duplicates">
            <h3 className="text-sm font-medium text-amber-200">
              {duplicates.length} skipped: already in your log
            </h3>
            <p className="text-xs text-slate-400">Each has the same date, amount and title as an entry you already have.</p>
            <ul className="space-y-1 text-xs text-slate-300">
              {duplicates.slice(0, LISTED_ROWS).map((entry) => (
                <li key={entry.row}>
                  Row {entry.row} · {entry.date} · {formatCurrency(entry.amountCents)}
                  {entry.title ? ` · ${entry.title}` : ""}
                </li>
              ))}
            </ul>
            <MoreRows total={duplicates.length} />
          </section>
        ) : null}

        {unreadableAmounts > 0 ? (
          <p className="text-sm text-slate-300">
            {unreadableAmounts} {unreadableAmounts === 1 ? "row was" : "rows were"} skipped for a missing or
            unreadable amount.
          </p>
        ) : null}

        <div className="flex justify-end">
          <button type="button" className={primaryBtnClass} onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MoreRows({ total }: { total: number }) {
  if (total <= LISTED_ROWS) return null;
  return <p className="text-xs text-slate-500">…and {total - LISTED_ROWS} more.</p>;
}
