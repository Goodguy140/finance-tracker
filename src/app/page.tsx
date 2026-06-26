import { Suspense } from "react";
import { CategoryKind, RecurringCadence, TransactionType } from "@prisma/client";
import Link from "next/link";
import {
  AddFormsDropdown,
  ExpenseForm,
  LogoutButton,
} from "@/components/forms";
import { DashboardMobileActions } from "@/components/dashboard-mobile-actions";
import { DashboardMonthFilter } from "@/components/dashboard-month-filter";
import { BudgetAlertsPanel } from "@/components/budget-alerts-panel";
import { DashboardBudgetsSpendSection } from "@/components/dashboard-budgets-spend-section";
import { ExpenseLogPanel } from "@/components/expense-log";
import { IncomeLogPanel } from "@/components/income-log";
import { RecurringTransactionsPanel } from "@/components/recurring-transactions-panel";
import {
  budgetPeriodMonthInYtd,
  currentPeriodYm,
  describeDashboardPeriod,
  endExclusiveOfMonthYm,
  parseDashboardSearchParams,
  shiftYm,
  startOfCalendarYearForYm,
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
import {
  bucketIncomeCentsByYm,
  computeRecurringCashFlowSummary,
  computeThreeMonthAverageIncomeCents,
  getPastMonthYmsBefore,
  getRecurringDateStatus,
} from "@/lib/recurring-transactions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const cadenceLabels: Record<RecurringCadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
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

type SearchParams = Promise<{ month?: string | string[]; range?: string | string[]; preset?: string | string[] }>;

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const anchorYm = currentPeriodYm(now);
  const period = parseDashboardSearchParams(sp, now);
  const periodDescription = describeDashboardPeriod(period);
  const transactionDateFilter = period.transactionDateFilter;
  const recurringIncomeAnchorYm = period.range === "lifetime" ? anchorYm : period.ym;
  const pastIncomeMonthsYm = getPastMonthYmsBefore(recurringIncomeAnchorYm, 3);

  const [accounts, categories, budgets, recurringTransactions, periodExpenses, periodIncomes, incomeTotal, titledExpenseHistory, pastIncomeTransactions, recentUnlinkedExpenses] =
    await Promise.all([
    prisma.account.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId: user.id }, include: { category: true }, orderBy: { updatedAt: "desc" } }),
    prisma.recurringTransaction.findMany({
      where: { userId: user.id },
      include: { category: true, account: true },
      orderBy: [{ enabled: "desc" }, { nextExpectedDate: "asc" }],
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
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        date: {
          gte: startOfMonthYm(pastIncomeMonthsYm[0]),
          lt: endExclusiveOfMonthYm(recurringIncomeAnchorYm),
        },
      },
      select: { amountCents: true, date: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        recurringTransactionId: null,
        date: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, title: true, date: true, amountCents: true },
      orderBy: { date: "desc" },
      take: 100,
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

  const recurringListItems = recurringTransactions.map((rule) => ({
    id: rule.id,
    type: rule.type,
    typeLabel: rule.type === TransactionType.INCOME ? "Income" : "Expense",
    name: rule.name,
    amountCents: rule.amountCents,
    accountId: rule.accountId,
    accountLabel: `${rule.account.name} (${formatAccountTypeLabel(rule.account.type)})`,
    categoryId: rule.categoryId,
    categoryLabel: rule.category.name,
    cadence: rule.cadence,
    cadenceLabel: cadenceLabels[rule.cadence],
    nextExpectedDateYmd: ymdFromDateUtc(rule.nextExpectedDate),
    nextExpectedDateDisplay: formatDateOnlyUtc(rule.nextExpectedDate),
    endDateYmd: rule.endDate ? ymdFromDateUtc(rule.endDate) : null,
    endDateDisplay: rule.endDate ? formatDateOnlyUtc(rule.endDate) : null,
    note: rule.note,
    enabled: rule.enabled,
    status: rule.enabled ? getRecurringDateStatus(rule.nextExpectedDate, now) : ("disabled" as const),
  }));

  const recentUnlinkedExpenseOptions = recentUnlinkedExpenses.map((txn) => ({
    id: txn.id,
    title: txn.title ?? "",
    dateDisplay: formatDateOnlyUtc(txn.date),
    amountCents: txn.amountCents,
  }));

  const recurringForecastPeriod =
    period.range === "ytd"
      ? { start: startOfCalendarYearForYm(period.ym), endExclusive: endExclusiveOfMonthYm(period.ym), label: periodDescription }
      : period.range === "month"
        ? { start: startOfMonthYm(period.ym), endExclusive: endExclusiveOfMonthYm(period.ym), label: periodDescription }
        : { start: startOfMonthYm(anchorYm), endExclusive: endExclusiveOfMonthYm(anchorYm), label: "Current month" };
  const expectedIncomeCents = computeThreeMonthAverageIncomeCents(
    pastIncomeMonthsYm,
    bucketIncomeCentsByYm(pastIncomeTransactions),
  );
  const recurringCashFlow = computeRecurringCashFlowSummary(recurringTransactions, recurringForecastPeriod, {
    expectedIncomeCents,
  });

  const spendVsBudgetLabel =
    period.range === "month"
      ? "Spend vs budgeted"
      : period.range === "ytd"
        ? "YTD spend vs summed budgets"
        : "Lifetime spend vs summed budgets";

  const incomeSumCents = incomeTotal._sum.amountCents ?? 0;
  const showDashboardIncomeCard = periodIncomes.length > 0 || incomeSumCents > 0;

  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-0 text-slate-100 lg:p-4 lg:pb-4">
      <div className="mx-auto max-w-7xl space-y-3 lg:space-y-4">
        <header className="relative z-40 max-lg:-mx-4 max-lg:border-x-0 max-lg:border-t-0 max-lg:border-b max-lg:border-slate-800/90 max-lg:bg-gradient-to-b max-lg:from-slate-900/95 max-lg:to-slate-900/80 max-lg:px-4 max-lg:pb-3 max-lg:pt-[max(0.625rem,env(safe-area-inset-top))] max-lg:shadow-lg max-lg:backdrop-blur-sm lg:rounded-2xl lg:border lg:border-slate-800/90 lg:bg-gradient-to-b lg:from-slate-900/90 lg:to-slate-900/70 lg:p-4 lg:shadow-xl lg:backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
            <div className="flex items-start justify-between gap-3 lg:block lg:shrink-0">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Finance Tracker</h1>
                <p className="truncate text-xs text-slate-400 sm:text-sm">
                  Welcome, {user.displayName} ({user.countryCode})
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 lg:hidden">
                <Link
                  href="/settings"
                  className="touch-manipulation inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                >
                  Settings
                </Link>
                <LogoutButton />
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end lg:items-center">
              <Suspense
                fallback={
                  <span className="text-xs text-slate-500" aria-hidden>
                    Period…
                  </span>
                }
              >
                <DashboardMonthFilter serverAnchorYm={anchorYm} className="w-full sm:max-w-md lg:max-w-none" />
              </Suspense>
              <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                <BudgetAlertsPanel
                  warnings={budgetWarnings}
                  paceTrends={budgetPaceTrends}
                  momTrends={budgetMomTrends}
                  periodLabel={periodDescription}
                  periodKey={period.ym}
                />
                <AddFormsDropdown
                  accounts={accountOptions}
                  expenseCategories={expenseCategoryOptions}
                  incomeCategories={incomeCategoryOptions}
                  defaultExpenseAccountId={user.defaultExpenseAccountId}
                />
                <div className="hidden items-center gap-2 lg:flex">
                  <Link
                    href="/settings"
                    className="touch-manipulation inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
                  >
                    Settings
                  </Link>
                  <LogoutButton />
                </div>
              </div>
            </div>
          </div>
        </header>

        <DashboardMobileActions
          accounts={accountOptions}
          expenseCategories={expenseCategoryOptions}
          incomeCategories={incomeCategoryOptions}
          defaultExpenseAccountId={user.defaultExpenseAccountId}
          titleSuggestions={expenseTitleSuggestions}
        />

        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-4">
          <div className="contents lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:flex lg:flex-col lg:gap-4">
            <div className="order-1">
              <DashboardBudgetsSpendSection
                periodDescription={periodDescription}
                periodRange={period.range}
                spendVsBudgetLabel={spendVsBudgetLabel}
                currentSpendCents={currentSpendCents}
                totalBudgetCents={totalBudgetCents}
                budgetProgressItems={budgetProgressItems}
                categoryPieSlices={categoryPieSlices}
              />
            </div>

            {showDashboardIncomeCard ? (
              <div className="order-3">
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

            <div className="order-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg sm:p-4">
                <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <h2 className="text-lg font-semibold">Recurring transactions</h2>
                  <p className="text-xs text-slate-400">
                    {recurringTransactions.length} rule{recurringTransactions.length === 1 ? "" : "s"} · due and upcoming first
                  </p>
                </div>
                <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Expected income</p>
                    <p className="text-sm font-semibold text-emerald-200">{formatCurrency(recurringCashFlow.incomeCents)}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">3-month average</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Expected expenses</p>
                    <p className="text-sm font-semibold text-blue-100">{formatCurrency(recurringCashFlow.expenseCents)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Net cash flow</p>
                    <p className={`text-sm font-semibold ${recurringCashFlow.netCents >= 0 ? "text-emerald-200" : "text-red-200"}`}>
                      {formatCurrency(recurringCashFlow.netCents)}
                    </p>
                  </div>
                </div>
                <p className="mb-3 text-xs text-slate-500">Forecast: {recurringForecastPeriod.label}</p>
                <RecurringTransactionsPanel
                  items={recurringListItems}
                  accounts={accountOptions}
                  expenseCategories={expenseCategoryOptions}
                  incomeCategories={incomeCategoryOptions}
                  recentExpenses={recentUnlinkedExpenseOptions}
                />
              </div>
            </div>
          </div>

          <div className="order-2 flex flex-col gap-4 lg:col-span-7 lg:row-start-1">
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
        </div>
      </div>
    </main>
  );
}
