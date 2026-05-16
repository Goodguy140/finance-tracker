import { Suspense } from "react";
import { BillingCycle, CategoryKind, TransactionType } from "@prisma/client";
import Link from "next/link";
import {
  AddFormsDropdown,
  ExpenseForm,
  LogoutButton,
} from "@/components/forms";
import { DashboardMobileActions } from "@/components/dashboard-mobile-actions";
import { DashboardMonthFilter } from "@/components/dashboard-month-filter";
import { BudgetAlertsPanel } from "@/components/budget-alerts-panel";
import { CategorySpendPieChart } from "@/components/category-spend-pie";
import { ExpenseLogPanel } from "@/components/expense-log";
import { IncomeLogPanel } from "@/components/income-log";
import { SubscriptionsPanel } from "@/components/subscriptions-panel";
import {
  budgetPeriodMonthInYtd,
  currentPeriodYm,
  describeDashboardPeriod,
  endExclusiveOfMonthYm,
  parseDashboardSearchParams,
  shiftYm,
  startOfMonthYm,
} from "@/lib/dashboard-period";
import {
  computeBudgetWarnings,
  computeMonthOverMonthTrends,
  computeOverBudgetTrends,
  type BudgetProgressInput,
} from "@/lib/budget-alerts";
import { formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { buildExpenseTitleSuggestions } from "@/lib/expense-title-suggestions";
import { formatCurrency } from "@/lib/money";
import { syncSubscriptionNextChargeDatesForUser } from "@/lib/subscription-next-charge";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const billingCycleLabels: Record<BillingCycle, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

type BudgetProgressRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
  progressPct: number;
};

type SearchParams = Promise<{ month?: string | string[]; range?: string | string[] }>;

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const anchorYm = currentPeriodYm(now);
  const period = parseDashboardSearchParams(sp, now);
  const periodDescription = describeDashboardPeriod(period);
  const transactionDateFilter = period.transactionDateFilter;

  await syncSubscriptionNextChargeDatesForUser(user.id);

  const [accounts, categories, budgets, subscriptions, periodExpenses, periodIncomes, incomeTotal, titledExpenseHistory] =
    await Promise.all([
    prisma.account.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId: user.id }, include: { category: true }, orderBy: { updatedAt: "desc" } }),
    prisma.subscription.findMany({
      where: { userId: user.id },
      include: { category: true, account: true },
      orderBy: { nextChargeDate: "asc" },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        ...transactionDateFilter,
      },
      include: { category: true, account: true, splitParts: { include: { category: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        ...transactionDateFilter,
      },
      include: { category: true, account: true },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        ...transactionDateFilter,
      },
      _sum: { amountCents: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        title: { not: null },
        splitParts: { none: {} },
      },
      select: { title: true, categoryId: true },
      orderBy: { date: "desc" },
      take: 400,
    }),
  ]);

  const expenseCategories = categories.filter((c) => c.kind === CategoryKind.EXPENSE);
  const incomeCategories = categories.filter((c) => c.kind === CategoryKind.INCOME);
  const accountOptions = accounts.map((a) => ({
    id: a.id,
    name: `${a.name} (${formatAccountTypeLabel(a.type)})`,
  }));
  const expenseCategoryOptions = expenseCategories.map((c) => ({ id: c.id, name: c.name }));
  const incomeCategoryOptions = incomeCategories.map((c) => ({ id: c.id, name: c.name }));
  const expenseTitleSuggestions = buildExpenseTitleSuggestions(titledExpenseHistory);

  const spendByCategory = new Map<string, number>();
  for (const expense of periodExpenses) {
    if (expense.splitParts.length > 0) {
      for (const part of expense.splitParts) {
        spendByCategory.set(part.categoryId, (spendByCategory.get(part.categoryId) ?? 0) + part.amountCents);
      }
      continue;
    }
    spendByCategory.set(expense.categoryId, (spendByCategory.get(expense.categoryId) ?? 0) + expense.amountCents);
  }

  const categoryName = (categoryId: string) =>
    categories.find((c) => c.id === categoryId)?.name ?? budgets.find((b) => b.categoryId === categoryId)?.category.name ?? "Unknown";

  let budgetProgressItems: BudgetProgressRow[];
  let totalBudgetCents: number;
  let configuredBudgetsCount: number;

  if (period.range === "month") {
    const activeBudgetsByCategory = new Map<string, (typeof budgets)[number]>();
    for (const budget of budgets) {
      if (budget.periodMonth > period.ym) continue;
      const existing = activeBudgetsByCategory.get(budget.categoryId);
      if (!existing || budget.periodMonth > existing.periodMonth) {
        activeBudgetsByCategory.set(budget.categoryId, budget);
      }
    }
    budgetProgressItems = Array.from(activeBudgetsByCategory.values())
      .map((budget) => {
        const spentCents = spendByCategory.get(budget.categoryId) ?? 0;
        const limitCents = budget.limitCents;
        const progressPct =
          limitCents > 0 ? Math.min(Math.max((spentCents / limitCents) * 100, 0), 100) : 0;
        return {
          id: budget.id,
          categoryId: budget.categoryId,
          categoryName: budget.category.name,
          spentCents,
          limitCents,
          progressPct,
        };
      })
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    totalBudgetCents = budgetProgressItems.reduce((sum, row) => sum + row.limitCents, 0);
    configuredBudgetsCount = activeBudgetsByCategory.size;
  } else if (period.range === "ytd") {
    const limitSumByCategory = new Map<string, number>();
    const nameByCategory = new Map<string, string>();
    for (const budget of budgets) {
      if (!budgetPeriodMonthInYtd(budget.periodMonth, period.ym)) continue;
      limitSumByCategory.set(
        budget.categoryId,
        (limitSumByCategory.get(budget.categoryId) ?? 0) + budget.limitCents,
      );
      if (!nameByCategory.has(budget.categoryId)) {
        nameByCategory.set(budget.categoryId, budget.category.name);
      }
    }
    const categoryIds = new Set([...limitSumByCategory.keys(), ...spendByCategory.keys()]);
    budgetProgressItems = Array.from(categoryIds)
      .map((categoryId) => {
        const limitCents = limitSumByCategory.get(categoryId) ?? 0;
        const spentCents = spendByCategory.get(categoryId) ?? 0;
        const progressPct =
          limitCents > 0 ? Math.min(Math.max((spentCents / limitCents) * 100, 0), 100) : 0;
        return {
          id: categoryId,
          categoryId,
          categoryName: nameByCategory.get(categoryId) ?? categoryName(categoryId),
          spentCents,
          limitCents,
          progressPct,
        };
      })
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    totalBudgetCents = budgetProgressItems.reduce((sum, row) => sum + row.limitCents, 0);
    configuredBudgetsCount = Array.from(limitSumByCategory.entries()).filter(([, cents]) => cents > 0).length;
  } else {
    const limitSumByCategory = new Map<string, number>();
    const nameByCategory = new Map<string, string>();
    for (const budget of budgets) {
      limitSumByCategory.set(
        budget.categoryId,
        (limitSumByCategory.get(budget.categoryId) ?? 0) + budget.limitCents,
      );
      if (!nameByCategory.has(budget.categoryId)) {
        nameByCategory.set(budget.categoryId, budget.category.name);
      }
    }
    const categoryIds = new Set([...limitSumByCategory.keys(), ...spendByCategory.keys()]);
    budgetProgressItems = Array.from(categoryIds)
      .map((categoryId) => {
        const limitCents = limitSumByCategory.get(categoryId) ?? 0;
        const spentCents = spendByCategory.get(categoryId) ?? 0;
        const progressPct =
          limitCents > 0 ? Math.min(Math.max((spentCents / limitCents) * 100, 0), 100) : 0;
        return {
          id: categoryId,
          categoryId,
          categoryName: nameByCategory.get(categoryId) ?? categoryName(categoryId),
          spentCents,
          limitCents,
          progressPct,
        };
      })
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    totalBudgetCents = budgetProgressItems.reduce((sum, row) => sum + row.limitCents, 0);
    configuredBudgetsCount = Array.from(limitSumByCategory.entries()).filter(([, cents]) => cents > 0).length;
  }

  let budgetWarnings: ReturnType<typeof computeBudgetWarnings> = [];
  let budgetPaceTrends: ReturnType<typeof computeOverBudgetTrends> = [];
  let budgetMomTrends: ReturnType<typeof computeMonthOverMonthTrends> = [];

  if (period.range === "month") {
    const progressInputs: BudgetProgressInput[] = budgetProgressItems.map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      spentCents: row.spentCents,
      limitCents: row.limitCents,
    }));

    budgetWarnings = computeBudgetWarnings(progressInputs, { ym: period.ym, reference: now });
    budgetPaceTrends = computeOverBudgetTrends(progressInputs, { ym: period.ym, reference: now });

    const priorYm = shiftYm(period.ym, -1);
    const priorExpenses = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        date: {
          gte: startOfMonthYm(priorYm),
          lt: endExclusiveOfMonthYm(priorYm),
        },
      },
      include: { splitParts: true },
    });
    const priorSpendByCategory = new Map<string, number>();
    for (const expense of priorExpenses) {
      if (expense.splitParts.length > 0) {
        for (const part of expense.splitParts) {
          priorSpendByCategory.set(
            part.categoryId,
            (priorSpendByCategory.get(part.categoryId) ?? 0) + part.amountCents,
          );
        }
        continue;
      }
      priorSpendByCategory.set(
        expense.categoryId,
        (priorSpendByCategory.get(expense.categoryId) ?? 0) + expense.amountCents,
      );
    }

    const priorActiveByCategory = new Map<string, (typeof budgets)[number]>();
    for (const budget of budgets) {
      if (budget.periodMonth > priorYm) continue;
      const existing = priorActiveByCategory.get(budget.categoryId);
      if (!existing || budget.periodMonth > existing.periodMonth) {
        priorActiveByCategory.set(budget.categoryId, budget);
      }
    }
    const priorByCategory = new Map<
      string,
      { categoryId: string; spentCents: number; limitCents: number }
    >();
    for (const [categoryId, budget] of priorActiveByCategory) {
      priorByCategory.set(categoryId, {
        categoryId,
        spentCents: priorSpendByCategory.get(categoryId) ?? 0,
        limitCents: budget.limitCents,
      });
    }

    budgetMomTrends = computeMonthOverMonthTrends(progressInputs, priorByCategory, {
      ym: period.ym,
      reference: now,
    });
  }

  const currentSpendCents = periodExpenses.reduce((sum, row) => sum + row.amountCents, 0);

  const categoryPieSlices = Array.from(spendByCategory.entries())
    .map(([categoryId, cents]) => {
      const cat = categories.find((c) => c.id === categoryId);
      return { name: cat?.name ?? "Unknown", cents };
    })
    .filter((s) => s.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

  const expenseLogEntries = periodExpenses.map((txn) => ({
    id: txn.id,
    amountCents: txn.amountCents,
    preCreditCents: txn.preCreditCents,
    creditCents: txn.creditCents,
    creditBreakdownJson: txn.creditBreakdownJson,
    dateYmd: ymdFromDateUtc(txn.date),
    dateDisplay: formatDateOnlyUtc(txn.date),
    postedDateYmd: txn.postedDate ? ymdFromDateUtc(txn.postedDate) : null,
    postedDateDisplay: txn.postedDate ? formatDateOnlyUtc(txn.postedDate) : null,
    title: txn.title,
    note: txn.note,
    accountId: txn.accountId,
    categoryId: txn.categoryId,
    accountLabel: txn.account
      ? `${txn.account.name} (${formatAccountTypeLabel(txn.account.type)})`
      : (txn.accountDescription ?? "Removed account"),
    categoryLabel: txn.category.name,
    isSplit: txn.splitParts.length > 0,
  }));

  const incomeLogEntries = periodIncomes.map((txn) => ({
    id: txn.id,
    amountCents: txn.amountCents,
    dateYmd: ymdFromDateUtc(txn.date),
    dateDisplay: formatDateOnlyUtc(txn.date),
    title: txn.title,
    note: txn.note,
    accountId: txn.accountId,
    categoryId: txn.categoryId,
    sourceLabel: txn.category.name,
    accountLabel: txn.account
      ? `${txn.account.name} (${formatAccountTypeLabel(txn.account.type)})`
      : (txn.accountDescription ?? "Removed account"),
  }));

  const subscriptionListItems = subscriptions.map((sub) => ({
    id: sub.id,
    name: sub.name,
    amountCents: sub.amountCents,
    accountId: sub.accountId,
    accountLabel: `${sub.account.name} (${formatAccountTypeLabel(sub.account.type)})`,
    categoryId: sub.categoryId,
    categoryLabel: sub.category.name,
    billingCycle: sub.billingCycle,
    billingCycleLabel: billingCycleLabels[sub.billingCycle],
    nextChargeDateYmd: ymdFromDateUtc(sub.nextChargeDate),
    nextChargeDateDisplay: formatDateOnlyUtc(sub.nextChargeDate),
  }));

  const spendVsBudgetLabel =
    period.range === "month"
      ? "Spend vs budgeted"
      : period.range === "ytd"
        ? "YTD spend vs summed budgets"
        : "Lifetime spend vs summed budgets";

  const incomeSumCents = incomeTotal._sum.amountCents ?? 0;
  const showDashboardIncomeCard = periodIncomes.length > 0 || incomeSumCents > 0;

  return (
    <main className="min-h-screen bg-slate-950 p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-slate-100 lg:pb-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="relative z-40 flex flex-col gap-3 rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/90 to-slate-900/70 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Finance Tracker</h1>
            <p className="text-sm text-slate-400">Welcome, {user.displayName} ({user.countryCode})</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Suspense
              fallback={
                <span className="text-xs text-slate-500" aria-hidden>
                  Period…
                </span>
              }
            >
              <DashboardMonthFilter anchorYm={anchorYm} />
            </Suspense>
            <AddFormsDropdown
              accounts={accountOptions}
              expenseCategories={expenseCategoryOptions}
              incomeCategories={incomeCategoryOptions}
              defaultExpenseAccountId={user.defaultExpenseAccountId}
            />
            <Link href="/settings" className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800">Settings</Link>
            <LogoutButton />
          </div>
        </header>

        <DashboardMobileActions
          accounts={accountOptions}
          expenseCategories={expenseCategoryOptions}
          incomeCategories={incomeCategoryOptions}
          defaultExpenseAccountId={user.defaultExpenseAccountId}
          titleSuggestions={expenseTitleSuggestions}
        />

        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:gap-4">
          <div className="order-1 flex flex-col gap-4 lg:order-none lg:col-span-5 lg:col-start-8">
            <BudgetAlertsPanel
              warnings={budgetWarnings}
              paceTrends={budgetPaceTrends}
              momTrends={budgetMomTrends}
              periodLabel={periodDescription}
              periodKey={period.ym}
            />

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Budgets</h2>
                <Link
                  href="/settings#budgets"
                  className="text-sm font-medium text-blue-300 underline-offset-4 transition hover:text-blue-200 hover:underline"
                >
                  Manage budgets
                </Link>
              </div>
              {period.range === "ytd" ? (
                <p className="mt-1 text-xs text-slate-400">
                  Budget limits are the sum of your saved monthly budgets from January through the selected month, compared
                  to spending in the same period.
                </p>
              ) : null}
              {period.range === "lifetime" ? (
                <p className="mt-1 text-xs text-slate-400">
                  Budget limits are the sum of every saved monthly budget per category (not a single monthly envelope).
                  Spending is all-time in the same categories.
                </p>
              ) : null}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                  <p className="text-xs uppercase tracking-wide text-slate-400">{spendVsBudgetLabel}</p>
                  <p className="text-base font-semibold">
                    {formatCurrency(currentSpendCents)} / {formatCurrency(totalBudgetCents)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    {period.range === "month" ? "Total budgeted" : "Total budgeted (summed)"}
                  </p>
                  <p className="text-base font-semibold">{formatCurrency(totalBudgetCents)}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Configured budgets</p>
                  <p className="text-base font-semibold">{configuredBudgetsCount}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {budgetProgressItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-200">{item.categoryName}</span>
                      <span className="text-slate-300">
                        {formatCurrency(item.spentCents)} / {formatCurrency(item.limitCents)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${item.progressPct >= 100 ? "bg-red-500" : item.progressPct >= 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                        style={{ width: `${item.progressPct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="order-2 flex flex-col gap-4 lg:order-none lg:col-span-7 lg:row-start-1">
            <section className="hidden rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg sm:p-4 lg:block">
              <h2 className="mb-3 text-lg font-semibold">Add Expense</h2>
              <ExpenseForm
                accounts={accountOptions}
                expenseCategories={expenseCategoryOptions}
                defaultExpenseAccountId={user.defaultExpenseAccountId}
                titleSuggestions={expenseTitleSuggestions}
              />
            </section>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-lg font-semibold">Expense Log</h2>
                <p className="text-xs text-slate-400">
                  {periodDescription} · {periodExpenses.length} transaction{periodExpenses.length === 1 ? "" : "s"}
                </p>
              </div>
              <ExpenseLogPanel
                entries={expenseLogEntries}
                accounts={accountOptions}
                categories={expenseCategoryOptions}
                titleSuggestions={expenseTitleSuggestions}
              />
            </section>
          </div>

          {showDashboardIncomeCard ? (
            <div className="order-3 lg:order-none lg:col-span-5 lg:col-start-8">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
                <div className="flex flex-col gap-3 border-b border-slate-800/80 pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-slate-100">Income</h2>
                    <p className="text-xs text-slate-400">{periodDescription}</p>
                    <p className="mt-2 text-xs tabular-nums text-slate-500">
                      {periodIncomes.length} deposit{periodIncomes.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="shrink-0 text-2xl font-bold tabular-nums text-emerald-200 sm:text-right">
                    {formatCurrency(incomeSumCents)}
                  </p>
                </div>
                <div className="pt-4">
                  <IncomeLogPanel entries={incomeLogEntries} accounts={accountOptions} categories={incomeCategoryOptions} />
                </div>
              </div>
            </div>
          ) : null}

          <div className="order-4 lg:order-none lg:col-span-5 lg:col-start-8">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
              <h2 className="text-lg font-semibold">Spending by category</h2>
              <p className="mt-1 text-xs text-slate-400">
                Net expense per category for this period ({periodDescription}). Slice size uses the absolute amount so
                categories with credits stay visible; the tooltip shows the signed total.
              </p>
              <CategorySpendPieChart data={categoryPieSlices} />
            </div>
          </div>

          <div className="order-5 lg:order-none lg:col-span-5 lg:col-start-8">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg sm:p-4">
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-lg font-semibold">Subscriptions</h2>
                <p className="text-xs text-slate-400">
                  {subscriptions.length} subscription{subscriptions.length === 1 ? "" : "s"} · next charge soonest first
                </p>
              </div>
              <SubscriptionsPanel items={subscriptionListItems} accounts={accountOptions} expenseCategories={expenseCategoryOptions} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
