import Link from "next/link";
import type { DashboardRange } from "@/lib/dashboard-period";
import { formatCurrency } from "@/lib/money";

export type DashboardBudgetProgressItem = {
  id: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
  /** Rollover carried in from earlier months, already part of `limitCents`; 0 when none. */
  carryCents?: number;
  progressPct: number;
};

export type BudgetsCardBodyProps = {
  periodRange: DashboardRange;
  spendVsBudgetLabel: string;
  currentSpendCents: number;
  totalBudgetCents: number;
  /** Spending on accounts in another currency, left out of every figure here; null when none. */
  otherCurrencySpending?: string | null;
  budgetProgressItems: DashboardBudgetProgressItem[];
  perRow?: 1 | 2 | 3;
  hideZeroSpend?: boolean;
  showPeriodNote?: boolean;
};

function BudgetPeriodNote({ periodRange }: { periodRange: DashboardRange }) {
  if (periodRange === "ytd") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        Limits are summed monthly budgets Jan–selected month; spending matches that window.
      </p>
    );
  }
  if (periodRange === "lifetime") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        Limits sum every saved monthly budget per category; spending is all-time in those categories.
      </p>
    );
  }
  return null;
}

/** What rollover added to (or took off) this month's limit. */
export function RolloverNote({ carryCents }: { carryCents: number }) {
  return (
    <p className="mt-1 text-xs text-slate-400" data-testid="budget-rollover-note">
      {carryCents > 0
        ? `Includes ${formatCurrency(carryCents)} left over from earlier months`
        : `${formatCurrency(-carryCents)} overspent in earlier months comes off this one`}
    </p>
  );
}

/** Header control for the Budgets card, hoisted out so the shell can place it. */
export function BudgetsCardActions() {
  return (
    <Link
      href="/settings/categories"
      className="shrink-0 text-sm font-medium text-blue-300 underline-offset-4 transition hover:text-blue-200 hover:underline"
    >
      Manage budgets
    </Link>
  );
}

export function BudgetsCardBody({
  periodRange,
  spendVsBudgetLabel,
  currentSpendCents,
  totalBudgetCents,
  otherCurrencySpending = null,
  budgetProgressItems,
  perRow = 1,
  hideZeroSpend = false,
  showPeriodNote = true,
}: BudgetsCardBodyProps) {
  const items = hideZeroSpend
    ? budgetProgressItems.filter((item) => item.spentCents !== 0)
    : budgetProgressItems;

  return (
    <>
      {showPeriodNote ? <BudgetPeriodNote periodRange={periodRange} /> : null}
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
        <p className="text-xs uppercase tracking-wide text-slate-400">{spendVsBudgetLabel}</p>
        <p className="text-base font-semibold">
          {formatCurrency(currentSpendCents)} / {formatCurrency(totalBudgetCents)}
        </p>
        {otherCurrencySpending ? (
          <p className="mt-0.5 text-xs text-slate-400" data-testid="budgets-other-currency">
            Not included: {otherCurrencySpending}
          </p>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          {hideZeroSpend && budgetProgressItems.length > 0
            ? "No spending against a budget in this period."
            : "No budgets set for this period."}
        </p>
      ) : (
        <div
          data-budget-rows={perRow}
          // The count comes from --budgets-per-row, which the card shell sets from the live
          // client settings. This body is rendered on the server, so reading an inherited
          // variable is what lets the setting reflow the rows without a server round trip.
          // Applied unconditionally rather than behind a container-query floor: the count is
          // an explicit choice, and minmax(0, 1fr) tracks shrink rather than overflow, so a
          // narrow column makes the rows tighter instead of breaking the layout.
          className="mt-3 grid gap-2 grid-cols-[repeat(var(--budgets-per-row,1),minmax(0,1fr))]"
        >
          {items.map((item) => (
            <div key={item.id} className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                {/* The name is what the row is about: the dashboard drops a column rather than
                    show less of it than the user's budget-name setting allows. */}
                <span data-min-visible="budget-name" className="truncate font-medium text-slate-200">
                  {item.categoryName}
                </span>
                <span className="shrink-0 tabular-nums text-slate-300">
                  {formatCurrency(item.spentCents)} / {formatCurrency(item.limitCents)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${item.progressPct >= 100 ? "bg-red-500" : item.progressPct >= 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                  style={{ width: `${item.progressPct}%` }}
                />
              </div>
              {item.carryCents ? <RolloverNote carryCents={item.carryCents} /> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
