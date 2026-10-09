"use client";

import { useRef, useState } from "react";
import { deleteBudgetAction, upsertBudgetAction } from "@/app/actions";
import {
  CurrencyAmountInput,
  formatBudgetPeriodLabel,
  getPreviousPeriodMonth,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  selectClass,
  type Option,
} from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { ConfirmDialog } from "@/components/settings/dialog";
import { formatCurrency } from "@/lib/money";

export type BudgetHistoryRow = {
  id: string;
  categoryName: string;
  periodMonth: string;
  limitCents: number;
};

function HistoryItem({ row }: { row: BudgetHistoryRow }) {
  const [confirm, setConfirm] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-100">{row.categoryName}</span>
        <span className="block text-xs text-slate-500">From {formatBudgetPeriodLabel(row.periodMonth)}</span>
      </span>
      <span className="text-sm tabular-nums text-slate-300">{formatCurrency(row.limitCents)}/mo</span>
      <ServerActionForm ref={form} action={deleteBudgetAction}>
        <input type="hidden" name="budgetId" value={row.id} />
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
          aria-label={`Remove ${row.categoryName} budget from ${formatBudgetPeriodLabel(row.periodMonth)}`}
          onClick={() => setConfirm(true)}
        >
          Remove
        </button>
      </ServerActionForm>
      {confirm ? (
        <ConfirmDialog
          title="Remove this budget?"
          body={`${row.categoryName}'s ${formatCurrency(row.limitCents)} limit from ${formatBudgetPeriodLabel(row.periodMonth)} is removed. Transactions are not affected.`}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            form.current?.requestSubmit();
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * Budgets other than the one in force this month: older limits a newer one replaced, and
 * limits set for a single past month. Folded on the Categories page, since setting this
 * month's budget is done on the category itself.
 */
export function BudgetHistory({ rows, expenseCategories }: { rows: BudgetHistoryRow[]; expenseCategories: Option[] }) {
  const [adding, setAdding] = useState(false);
  const previous = getPreviousPeriodMonth();
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No earlier budgets.</p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/30">
          {rows.map((row) => (
            <HistoryItem key={row.id} row={row} />
          ))}
        </ul>
      )}
      {adding ? (
        <ServerActionForm
          action={upsertBudgetAction}
          onSuccess={() => setAdding(false)}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 p-3 sm:grid-cols-3 sm:items-end"
        >
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-400">Category</span>
            <select name="categoryName" className={selectClass} required defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-400">Month</span>
            <input type="month" name="periodMonth" max={previous} defaultValue={previous} className={inputClass} required />
          </label>
          <CurrencyAmountInput name="limit" label="Limit" placeholder="0.00" required />
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" className={primaryBtnClass}>
              Save past-month budget
            </button>
            <button type="button" className={secondaryBtnClass} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </ServerActionForm>
      ) : (
        <button type="button" className={secondaryBtnClass} onClick={() => setAdding(true)}>
          Set a budget for a past month
        </button>
      )}
    </div>
  );
}
