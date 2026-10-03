import {
  RecurringTransactionsPanel,
  type RecentExpenseOption,
  type RecurringTransactionListItem,
} from "@/components/recurring-transactions-panel";
import { formatCurrency } from "@/lib/money";

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
  /** Rules left off because they do not fall in the month on screen. */
  outsidePeriodCount?: number;
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
  outsidePeriodCount = 0,
  periodLabel,
}: RecurringCardBodyProps) {
  // Items arrive sorted due-and-upcoming first, so a limit keeps what matters.
  const shown = rowLimit ? items.slice(0, rowLimit) : items;
  const hidden = items.length - shown.length;

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
      {items.length === 0 && outsidePeriodCount > 0 ? (
        <p className="text-sm text-slate-400">No recurring transactions in {periodLabel ?? "this month"}.</p>
      ) : (
        <RecurringTransactionsPanel
          items={shown}
          accounts={accounts}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          recentExpenses={recentExpenses}
          recentIncomes={recentIncomes}
        />
      )}
      {outsidePeriodCount > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {outsidePeriodCount} rule{outsidePeriodCount === 1 ? "" : "s"} not in {periodLabel ?? "this month"} · pick
          another month to see {outsidePeriodCount === 1 ? "it" : "them"}
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
