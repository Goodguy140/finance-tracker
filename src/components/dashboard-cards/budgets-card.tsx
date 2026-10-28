import Link from "next/link";
import type { DashboardRange } from "@/lib/dashboard-period";
import { hasGroups, sectionByGroup } from "@/lib/category-groups";
import { formatCurrency } from "@/lib/money";
import type { YearlyBudgetRow } from "@/lib/yearly-budgets";

export type DashboardBudgetProgressItem = {
  id: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
  /** Rollover carried in from earlier months, already part of `limitCents`; 0 when none. */
  carryCents?: number;
  progressPct: number;
  /** The category's group; rows are shown under their groups once any category has one. */
  groupName?: string | null;
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
  /** Days left in the month, counting today; set only when the period is the current month. */
  daysLeftInMonth?: number | null;
  /** Yearly budgets in force for the period's year, as sinking funds; kept out of the totals above. */
  yearlyBudgets?: YearlyBudgetRow[];
};

/** "$414 left" or "$1,413 over", or null when there is no limit to measure against. */
export function budgetRemainingText(spentCents: number, limitCents: number): string | null {
  if (limitCents <= 0) return null;
  const remaining = limitCents - spentCents;
  return remaining >= 0 ? `${formatCurrency(remaining)} left` : `${formatCurrency(-remaining)} over`;
}

function RemainingLine({ spentCents, limitCents }: { spentCents: number; limitCents: number }) {
  const text = budgetRemainingText(spentCents, limitCents);
  if (!text) return null;
  const over = spentCents > limitCents;
  return (
    <span data-testid="budget-remaining" className={`text-xs tabular-nums ${over ? "text-red-300" : "text-slate-400"}`}>
      {text}
    </span>
  );
}

function BudgetPeriodNote({ periodRange }: { periodRange: DashboardRange }) {
  if (periodRange === "ytd") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        Limits are summed monthly budgets Jan–selected month; spending matches that window.
      </p>
    );
  }
  if (periodRange === "custom") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        Limits sum the monthly budgets of every month the range touches; spending is the range&apos;s own.
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
  daysLeftInMonth = null,
  yearlyBudgets = [],
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
        <p className="flex flex-wrap gap-x-2 text-xs text-slate-400">
          <RemainingLine spentCents={currentSpendCents} limitCents={totalBudgetCents} />
          {daysLeftInMonth != null ? (
            <span data-testid="budget-days-left">
              {daysLeftInMonth === 1 ? "Last day of the month" : `${daysLeftInMonth} days left in the month`}
            </span>
          ) : null}
        </p>
        {otherCurrencySpending ? (
          <p className="mt-0.5 text-xs text-slate-400" data-testid="budgets-other-currency">
            Not included: {otherCurrencySpending}
          </p>
        ) : null}
      </div>
      {items.length === 0 && yearlyBudgets.length > 0 && budgetProgressItems.length === 0 ? null : items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          {hideZeroSpend && budgetProgressItems.length > 0 ? (
            "No spending against a budget in this period."
          ) : (
            <>
              No budgets set for this period.{" "}
              <Link
                href="/settings/categories?suggest=1"
                className="text-blue-300 underline-offset-4 hover:text-blue-200 hover:underline"
              >
                Suggest budgets from your spending
              </Link>
            </>
          )}
        </p>
      ) : (
        <BudgetRowSections items={items} perRow={perRow} />
      )}
      {yearlyBudgets.length > 0 ? <YearlyBudgets rows={yearlyBudgets} /> : null}
    </>
  );
}

/** The rows as one grid, or under a heading per group with the group's total once any has one. */
function BudgetRowSections({ items, perRow }: { items: DashboardBudgetProgressItem[]; perRow: 1 | 2 | 3 }) {
  if (!hasGroups(items, (item) => item.groupName)) return <BudgetRowGrid items={items} perRow={perRow} />;
  return (
    <div className="mt-3 space-y-3">
      {sectionByGroup(items, (item) => item.groupName).map((section) => {
        const spent = section.items.reduce((sum, item) => sum + item.spentCents, 0);
        const limit = section.items.reduce((sum, item) => sum + item.limitCents, 0);
        return (
          <section key={section.groupName ?? ""} data-testid="budget-group" aria-label={section.groupName ?? "Not grouped"}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
              <h3 className="font-semibold uppercase tracking-wide text-slate-400">{section.groupName ?? "Not grouped"}</h3>
              {section.groupName ? (
                <span className="flex gap-2 tabular-nums text-slate-400" data-testid="budget-group-total">
                  <span>
                    {formatCurrency(spent)} / {formatCurrency(limit)}
                  </span>
                  <RemainingLine spentCents={spent} limitCents={limit} />
                </span>
              ) : null}
            </div>
            <BudgetRowGrid items={section.items} perRow={perRow} className="mt-1.5" />
          </section>
        );
      })}
    </div>
  );
}

function BudgetRowGrid({
  items,
  perRow,
  className = "mt-3",
}: {
  items: DashboardBudgetProgressItem[];
  perRow: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <div
      data-budget-rows={perRow}
      // The count comes from --budgets-per-row, which the card shell sets from the live
      // client settings. This body is rendered on the server, so reading an inherited
      // variable is what lets the setting reflow the rows without a server round trip.
      // Applied unconditionally rather than behind a container-query floor: the count is
      // an explicit choice, and minmax(0, 1fr) tracks shrink rather than overflow, so a
      // narrow column makes the rows tighter instead of breaking the layout.
      className={`${className} grid gap-2 grid-cols-[repeat(var(--budgets-per-row,1),minmax(0,1fr))]`}
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
          <div className="mt-1 flex justify-end">
            <RemainingLine spentCents={item.spentCents} limitCents={item.limitCents} />
          </div>
          {item.carryCents ? <RolloverNote carryCents={item.carryCents} /> : null}
        </div>
      ))}
    </div>
  );
}

/** "$1,100 in the fund" or "$150 spent ahead of the fund": set aside so far less spent. */
export function sinkingFundText(fundCents: number): string {
  return fundCents >= 0 ? `${formatCurrency(fundCents)} in the fund` : `${formatCurrency(-fundCents)} spent ahead of the fund`;
}

/** Yearly budgets as sinking funds: spent this year against the year's limit, and what the fund holds. */
function YearlyBudgets({ rows }: { rows: YearlyBudgetRow[] }) {
  return (
    <section aria-label="Yearly budgets" className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Yearly budgets</h3>
      <div className="mt-1.5 grid gap-2 grid-cols-[repeat(var(--budgets-per-row,1),minmax(0,1fr))]">
        {rows.map((row) => {
          const pct = row.limitCents > 0 ? Math.min(100, Math.max(0, (row.spentCents / row.limitCents) * 100)) : 0;
          return (
            <div
              key={row.categoryId}
              data-testid="yearly-budget"
              className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5"
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium text-slate-200">{row.categoryName}</span>
                <span className="shrink-0 tabular-nums text-slate-300">
                  {formatCurrency(row.spentCents)} / {formatCurrency(row.limitCents)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${row.spentCents > row.limitCents ? "bg-red-500" : "bg-sky-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 flex flex-wrap justify-between gap-x-2 text-xs tabular-nums text-slate-400">
                <span>{formatCurrency(row.monthlyCents)} a month</span>
                <span data-testid="yearly-budget-fund" className={row.fundCents < 0 ? "text-amber-300" : undefined}>
                  {sinkingFundText(row.fundCents)}
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
