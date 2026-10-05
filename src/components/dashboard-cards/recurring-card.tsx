"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  RecurringTransactionsPanel,
  type RecentExpenseOption,
  type RecurringTransactionListItem,
} from "@/components/recurring-transactions-panel";
import { RecurringRuleForm } from "@/components/recurring-rule-form";
import { formatCurrency } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";

type Option = { id: string; name: string };

export type RecurringCardBodyProps = {
  items: RecurringTransactionListItem[];
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  recentExpenses?: RecentExpenseOption[];
  recentIncomes?: RecentExpenseOption[];
  cashFlow: { incomeCents: number; expenseCents: number; netCents: number };
  forecastLabel: string;
  showCashFlowSummary?: boolean;
  rowLimit?: number;
  /** Rules left off because they do not fall in the month on screen, at their next date. */
  otherItems?: RecurringTransactionListItem[];
  periodLabel?: string;
};

export function RecurringCardBody({
  items,
  accounts,
  expenseCategories,
  incomeCategories,
  recentExpenses,
  recentIncomes,
  cashFlow,
  forecastLabel,
  showCashFlowSummary = true,
  rowLimit,
  otherItems = [],
  periodLabel,
}: RecurringCardBodyProps) {
  const [showOthers, setShowOthers] = useState(false);
  // Items arrive sorted due-and-upcoming first, so a limit keeps what matters.
  const shown = rowLimit ? items.slice(0, rowLimit) : items;
  const hidden = items.length - shown.length;
  const monthLabel = periodLabel ?? "this month";
  const otherCount = otherItems.length;

  return (
    <>
      {showCashFlowSummary ? (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 @md:grid-cols-3">
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Expected income</p>
              <p className="truncate text-sm font-semibold text-emerald-200">{formatCurrency(cashFlow.incomeCents)}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">3-month average</p>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Expected expenses</p>
              <p className="truncate text-sm font-semibold text-blue-100">{formatCurrency(cashFlow.expenseCents)}</p>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Net cash flow</p>
              <p
                className={`truncate text-sm font-semibold ${cashFlow.netCents >= 0 ? "text-emerald-200" : "text-red-200"}`}
              >
                {formatCurrency(cashFlow.netCents)}
              </p>
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500">Forecast: {forecastLabel}</p>
        </>
      ) : null}
      {items.length === 0 && otherCount > 0 && !showOthers ? (
        <p className="text-sm text-slate-400">No recurring transactions in {monthLabel}.</p>
      ) : (
        <RecurringTransactionsPanel
          items={shown}
          otherItems={showOthers ? otherItems : []}
          accounts={accounts}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          recentExpenses={recentExpenses}
          recentIncomes={recentIncomes}
        />
      )}
      {otherCount > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {otherCount} rule{otherCount === 1 ? "" : "s"} not in {monthLabel} ·{" "}
          <button
            type="button"
            onClick={() => setShowOthers((value) => !value)}
            aria-expanded={showOthers}
            className="font-medium text-slate-300 underline underline-offset-2 hover:text-slate-100"
          >
            {showOthers ? "hide" : otherCount === 1 ? "show it" : "show them"}
          </button>
        </p>
      ) : null}
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {hidden} more rule{hidden === 1 ? "" : "s"} hidden · raise “Rules shown” in this card’s settings
        </p>
      ) : null}
    </>
  );
}

/**
 * The Recurring card's "New rule" control. The card is where rules are posted, skipped, edited
 * and removed, so adding one belongs here too rather than in a separate menu.
 */
export function RecurringCardActions({
  accounts,
  expenseCategories,
  incomeCategories,
  defaultExpenseAccountId,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  defaultExpenseAccountId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-manipulation inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2 py-1 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
      >
        <span aria-hidden>+</span> New rule
      </button>
      {/* Portalled: a card body is a size container, which would clip a fixed overlay to it. */}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-center justify-center bg-black/60 p-3`}>
              <div
                role="dialog"
                aria-modal="true"
                aria-label="New recurring transaction"
                className="max-h-[min(92vh,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl"
              >
                <h3 className="text-lg font-semibold text-slate-100">New recurring transaction</h3>
                <div className="mt-3">
                  <RecurringRuleForm
                    accounts={accounts}
                    expenseCategories={expenseCategories}
                    incomeCategories={incomeCategories}
                    defaultExpenseAccountId={defaultExpenseAccountId}
                    onSuccess={() => setOpen(false)}
                    onCancel={() => setOpen(false)}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
