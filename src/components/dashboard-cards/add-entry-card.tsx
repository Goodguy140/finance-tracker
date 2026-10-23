"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { ExpenseForm, IncomeForm, TransferForm } from "@/components/forms";
import { isDesktopViewport, useQuickAddRequest } from "@/lib/search/dashboard-requests";

type Option = { id: string; name: string };
type EntryKind = "expense" | "income" | "transfer";
const ENTRY_KINDS: EntryKind[] = ["expense", "income", "transfer"];
const KIND_LABEL: Record<EntryKind, string> = { expense: "Expense", income: "Income", transfer: "Transfer" };

/** Which side was used last, per browser. A convenience, not a setting, so it is not synced. */
const KIND_STORAGE_KEY = "dashboard.add-card.kind";

/**
 * The Add card: logging an expense or an income from the same place. Income used to sit behind
 * the header's Add menu, a click and a tab away from the expense form beside it; the phone has
 * long had both side by side as its two quick-add buttons, and this is the desktop's version.
 * Transfers sit beside them: money moved between the user's own accounts, counted as neither.
 */
export function AddEntryCardBody({
  expense,
  incomeCategories,
}: {
  expense: ComponentProps<typeof ExpenseForm>;
  incomeCategories: Option[];
}) {
  const [kind, setKind] = useState<EntryKind>("expense");
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  // Read after mount: the server renders the expense side, and storage can be unavailable.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KIND_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore after hydration
      if (stored === "income" || stored === "transfer") setKind(stored);
    } catch {
      // Private windows and blocked storage just start on Expense.
    }
  }, []);

  // "Add expense / income / transfer" from the master search. Phones have no Add card; their
  // quick-add sheet answers there.
  useQuickAddRequest((requested) => {
    if (requested === "recurring" || !isDesktopViewport()) return;
    choose(requested);
    setFocusRequest((n) => n + 1);
  });

  // After the chosen form has rendered: bring the card into view and put the cursor in it.
  useEffect(() => {
    if (focusRequest === 0) return;
    const root = rootRef.current;
    if (!root) return;
    root.scrollIntoView({ block: "center", behavior: "smooth" });
    root.querySelector<HTMLElement>("form input:not([type=hidden]), form select, form textarea")?.focus({ preventScroll: true });
  }, [focusRequest]);

  function choose(next: EntryKind) {
    setKind(next);
    try {
      window.localStorage.setItem(KIND_STORAGE_KEY, next);
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }

  return (
    <div ref={rootRef}>
      <div role="radiogroup" aria-label="What to add" className="mb-3 inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5">
        {ENTRY_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            onClick={() => choose(option)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              kind === option ? "bg-blue-500 text-white" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {KIND_LABEL[option]}
          </button>
        ))}
      </div>
      {kind === "expense" ? (
        <ExpenseForm {...expense} />
      ) : kind === "income" ? (
        <IncomeForm accounts={expense.accounts} incomeCategories={incomeCategories} />
      ) : (
        <TransferForm accounts={expense.accounts} />
      )}
    </div>
  );
}
