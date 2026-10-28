"use client";

import { useState, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { applyBudgetSuggestionsAction } from "@/app/actions";
import { inputClass, noopSubscribe, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { FormDialog } from "@/components/settings/dialog";
import type { BudgetSuggestion, BudgetSuggestionSet } from "@/lib/budget-suggestions";
import { formatYmShortLabel } from "@/lib/dashboard-period";
import { formatCurrency, parseCentsInput } from "@/lib/money";

type RowState = { ticked: boolean; amount: string };

function initialState(rows: BudgetSuggestion[]): Record<string, RowState> {
  return Object.fromEntries(
    rows.map((row) => [
      row.categoryId,
      // Categories already budgeted start unticked: the suggestion is there to compare with.
      { ticked: row.currentLimitCents === null, amount: (row.suggestedCents / 100).toFixed(0) },
    ]),
  );
}

function MonthsLine({ row, months }: { row: BudgetSuggestion; months: string[] }) {
  return (
    <span className="block text-xs text-slate-500">
      {months.map((ym, i) => {
        const spike = row.spikeMonths.includes(ym);
        return (
          <span key={ym} className={spike ? "text-amber-300/90" : undefined}>
            {i > 0 ? " · " : ""}
            {formatYmShortLabel(ym, false)} {formatCurrency(row.monthlyCents[i])}
            {spike ? " (one-off, passed over)" : ""}
          </span>
        );
      })}
    </span>
  );
}

function SuggestionsDialog({
  sets,
  currentBudgets,
  onClose,
}: {
  sets: BudgetSuggestionSet[];
  currentBudgets: Record<string, number>;
  onClose: () => void;
}) {
  const [span, setSpan] = useState(sets[0]?.window ?? 3);
  const set = sets.find((s) => s.window === span) ?? sets[0];
  const [state, setState] = useState(() => initialState(set.rows));

  const ticked = set.rows.flatMap((row) => {
    const s = state[row.categoryId];
    const cents = s?.ticked ? parseCentsInput(s.amount) : null;
    return cents && cents > 0 ? [{ categoryId: row.categoryId, limitCents: cents }] : [];
  });
  const invalid = set.rows.some((row) => state[row.categoryId]?.ticked && !(parseCentsInput(state[row.categoryId].amount) ?? 0));
  const merged = { ...currentBudgets };
  for (const row of ticked) merged[row.categoryId] = row.limitCents;
  const totalAfter = Object.values(merged).reduce((sum, cents) => sum + cents, 0);

  const update = (categoryId: string, patch: Partial<RowState>) =>
    setState((prev) => ({ ...prev, [categoryId]: { ...prev[categoryId], ...patch } }));

  return (
    <FormDialog title="Suggest budgets" onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
        <span>Based on the last</span>
        {sets.map((s) => (
          <button
            key={s.window}
            type="button"
            aria-pressed={s.window === span}
            onClick={() => {
              setSpan(s.window);
              setState(initialState(s.rows));
            }}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              s.window === span
                ? "border-blue-400/60 bg-blue-500/15 text-blue-100"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {s.window} months
          </button>
        ))}
      </div>
      {set.months.length === 0 || set.rows.length === 0 ? (
        <p className="text-sm text-slate-400" data-testid="budget-suggestions-empty">
          There is no full month of spending to go on yet. Come back after your first month of transactions.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            Each amount is a typical month of {formatYmShortLabel(set.months[0])}
            {set.months.length > 1 ? ` to ${formatYmShortLabel(set.months[set.months.length - 1])}` : ""} (the median, so a
            one-off month does not count), rounded up. Ticked ones are set from this month on.
          </p>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/30">
            {set.rows.map((row) => {
              const s = state[row.categoryId];
              const inputId = `suggest-${row.categoryId}`;
              return (
                <li key={row.categoryId} className="flex items-start gap-3 px-3 py-2.5" data-testid="budget-suggestion-row">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-blue-500"
                    checked={s?.ticked ?? false}
                    onChange={(e) => update(row.categoryId, { ticked: e.target.checked })}
                    aria-label={`Set ${row.categoryName}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">{row.categoryName}</span>
                    <MonthsLine row={row} months={set.months} />
                    {row.currentLimitCents !== null ? (
                      <span className="block text-xs text-slate-500">Budget now {formatCurrency(row.currentLimitCents)}</span>
                    ) : null}
                  </span>
                  <label htmlFor={inputId} className="sr-only">
                    {row.categoryName} monthly budget
                  </label>
                  <input
                    id={inputId}
                    inputMode="decimal"
                    className={`${inputClass} w-24 text-right tabular-nums`}
                    value={s?.amount ?? ""}
                    onChange={(e) => update(row.categoryId, { amount: e.target.value, ticked: true })}
                  />
                </li>
              );
            })}
          </ul>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm" data-testid="budget-suggestions-total">
            <p className="text-slate-200">
              All budgets after this: <span className="tabular-nums">{formatCurrency(totalAfter)}</span> a month
            </p>
            {set.averageIncomeCents > 0 ? (
              <p className={`text-xs ${totalAfter > set.averageIncomeCents ? "text-red-300" : "text-slate-400"}`}>
                Average income {formatCurrency(set.averageIncomeCents)} a month,{" "}
                {totalAfter > set.averageIncomeCents
                  ? `${formatCurrency(totalAfter - set.averageIncomeCents)} more than comes in`
                  : `leaving ${formatCurrency(set.averageIncomeCents - totalAfter)}`}
              </p>
            ) : null}
          </div>
        </>
      )}
      <ServerActionForm action={applyBudgetSuggestionsAction} onSuccess={onClose} className="flex flex-wrap justify-end gap-2">
        <input type="hidden" name="budgets" value={JSON.stringify(ticked)} />
        <button type="button" className={secondaryBtnClass} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={primaryBtnClass} disabled={ticked.length === 0 || invalid}>
          {ticked.length === 1 ? "Set 1 budget" : `Set ${ticked.length} budgets`}
        </button>
      </ServerActionForm>
    </FormDialog>
  );
}

/**
 * "Suggest budgets": proposes a monthly amount per expense category from past spending, to
 * tick and set in one go. `autoOpen` opens it on arrival, for links from the Budgets card and
 * Get started (opened after mount, since the dialog is a portal the server cannot render).
 */
export function BudgetSuggestions({
  sets,
  currentBudgets,
  autoOpen = false,
}: {
  sets: BudgetSuggestionSet[];
  currentBudgets: Record<string, number>;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [autoClosed, setAutoClosed] = useState(false);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const shown = open || (autoOpen && mounted && !autoClosed);
  const close = () => {
    setOpen(false);
    setAutoClosed(true);
  };
  if (sets.length === 0) return null;
  return (
    <>
      <button type="button" className={`${secondaryBtnClass} gap-2`} onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4 text-blue-300" aria-hidden />
        Suggest budgets
      </button>
      {shown ? <SuggestionsDialog sets={sets} currentBudgets={currentBudgets} onClose={close} /> : null}
    </>
  );
}
