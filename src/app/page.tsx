import { Suspense } from "react";
import { CategoryKind, PlaidStagedStatus, RecurringCadence, TransactionType } from "@prisma/client";
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
import { CumulativeSpendCard } from "@/components/cumulative-spend-card";
import { ExpenseLogPanel } from "@/components/expense-log";
import { IncomeLogPanel } from "@/components/income-log";
import { RecurringTransactionsPanel } from "@/components/recurring-transactions-panel";
import {
  budgetPeriodMonthInYtd,
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
import {
  buildBudgetProgressRows,
  computeSpendByCategory,
  selectActiveBudgetsByCategory,
  type BudgetProgressRow,
} from "@/lib/budget-progress";
import { buildCumulativeSpendSeries, resolveMonthlyExpected } from "@/lib/cumulative-spend";
import { formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import type { VerificationInfo } from "@/components/verified-badge";
import { PlaidReviewQueue } from "@/components/plaid-review-queue";
import { buildExpenseTitleSuggestions } from "@/lib/expense-title-suggestions";
import { formatCurrency } from "@/lib/money";
import {
  bucketIncomeCentsByYm,
  computeRecurringCashFlowSummary,
  computeThreeMonthAverageIncomeCents,
  getPastMonthYmsBefore,
  getRecurringDateStatus,
} from "@/lib/recurring-transactions";
import { currentYmdInTimeZone, currentYmInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { autoPostDueRecurringTransactions } from "@/lib/recurring-post";
import { requireUser } from "@/lib/session";

const cadenceLabels: Record<RecurringCadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

type SearchParams = Promise<{ month?: string | string[]; range?: string | string[]; preset?: string | string[] }>;

export const dynamic = "force-dynamic";

/** Shapes a stored verification for the log badge; null for unverified rows. */
function toVerificationInfo(
  row: { source: string; institutionName: string | null; verifiedAt: Date; removedByPlaidAt: Date | null; itemRemovedAt: Date | null } | null,
): VerificationInfo | null {
  if (!row) return null;
  return {
    source: row.source === "MATCHED" ? "MATCHED" : "IMPORTED",
    institutionName: row.institutionName,
    verifiedAtDisplay: formatDateOnlyUtc(row.verifiedAt),
    removedByPlaid: row.removedByPlaidAt !== null,
    itemRemoved: row.itemRemovedAt !== null,
  };
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  // Rules in AUTO mode post themselves; doing it here as well as on the hourly sweep
  // means an occurrence due today is already in the log by the time the page renders.
  try {
    await autoPostDueRecurringTransactions(user.id, now);
  } catch (err) {
    console.error("[recurring] auto-post on dashboard load failed", err);
  }
  const anchorYm = currentYmInTimeZone(user.timezone, now);
  const period = parseDashboardSearchParams(sp, now, user.timezone);
  const periodDescription = describeDashboardPeriod(period);
  const transactionDateFilter = period.transactionDateFilter;
  const recurringIncomeAnchorYm = period.range === "lifetime" ? anchorYm : period.ym;
  // Shared by the recurring income average and the cumulative chart's expected baseline.
  const pastThreeMonthYms = getPastMonthYmsBefore(recurringIncomeAnchorYm, 3);
  // Categories not touched by a transaction (or split part) in the last 3 months are
  // hidden from the "add" pickers to keep the list focused on what's actually in use.
  const categoryUsageCutoff = new Date(now);
  categoryUsageCutoff.setMonth(categoryUsageCutoff.getMonth() - 3);

  const [accounts, categories, budgets, recurringTransactions, stagedRows, revisedRows, periodExpenses, periodIncomes, incomeTotal, titledExpenseHistory, pastIncomeTransactions, pastExpenseTransactions, recentUnlinkedExpenses, recentUnlinkedIncomes, recentExpenseCategoryUsage, recentSplitCategoryUsage, plaidItemCount] =
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
    prisma.plaidStagedTransaction.findMany({
      where: { userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW },
      include: { plaidItem: { select: { institutionName: true } } },
      orderBy: [{ date: "desc" }, { name: "asc" }],
      take: 200,
    }),
    prisma.plaidStagedTransaction.findMany({
      where: { userId: user.id, revisedAfterResolveAt: { not: null } },
      include: { plaidItem: { select: { institutionName: true } } },
      orderBy: { revisedAfterResolveAt: "desc" },
      take: 50,
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        ...transactionDateFilter,
      },
      include: {
        category: true,
        account: true,
        splitParts: { include: { category: true } },
        verification: true,
      },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        ...transactionDateFilter,
      },
      include: { category: true, account: true, verification: true },
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
          gte: startOfMonthYm(pastThreeMonthYms[0]),
          lt: endExclusiveOfMonthYm(recurringIncomeAnchorYm),
        },
      },
      select: { amountCents: true, date: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        date: {
          gte: startOfMonthYm(pastThreeMonthYms[0]),
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
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        recurringTransactionId: null,
        date: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, title: true, date: true, amountCents: true },
      orderBy: { date: "desc" },
      take: 100,
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        date: { gte: categoryUsageCutoff },
      },
      select: { categoryId: true },
      distinct: ["categoryId"],
    }),
    prisma.splitTransactionPart.findMany({
      where: {
        userId: user.id,
        transaction: { date: { gte: categoryUsageCutoff } },
      },
      select: { categoryId: true },
      distinct: ["categoryId"],
    }),
    // Only decides whether the log's refresh control is worth showing.
    prisma.plaidItem.count({ where: { userId: user.id } }),
  ]);

  const expenseCategories = categories.filter((c) => c.kind === CategoryKind.EXPENSE);
  const incomeCategories = categories.filter((c) => c.kind === CategoryKind.INCOME);
  const accountOptions = accounts.map((a) => ({
    id: a.id,
    name: `${a.name} (${formatAccountTypeLabel(a.type)})`,
  }));
  const expenseCategoryOptions = expenseCategories.map((c) => ({ id: c.id, name: c.name }));
  // Options for the "add expense" pickers: hide categories with no transaction in the
  // last 3 months. Recently-created categories are kept (so a brand-new category can be
  // used), and if every category would be hidden we fall back to the full list so a
  // dormant account is never left unable to add an expense. The full
  // `expenseCategoryOptions` is still used for edit forms, where the original category
  // must remain selectable even if it's now stale.
  const recentlyUsedExpenseCategoryIds = new Set<string>([
    ...recentExpenseCategoryUsage.map((t) => t.categoryId),
    ...recentSplitCategoryUsage.map((s) => s.categoryId),
  ]);
  const recentlyUsedExpenseCategories = expenseCategories.filter(
    (c) => recentlyUsedExpenseCategoryIds.has(c.id) || c.createdAt >= categoryUsageCutoff,
  );
  const expenseCategoryAddOptions = (
    recentlyUsedExpenseCategories.length > 0 ? recentlyUsedExpenseCategories : expenseCategories
  ).map((c) => ({ id: c.id, name: c.name }));
  const incomeCategoryOptions = incomeCategories.map((c) => ({ id: c.id, name: c.name }));
  const expenseTitleSuggestions = buildExpenseTitleSuggestions(titledExpenseHistory);

  const spendByCategory = computeSpendByCategory(periodExpenses);

  const categoryName = (categoryId: string) =>
    categories.find((c) => c.id === categoryId)?.name ?? budgets.find((b) => b.categoryId === categoryId)?.category.name ?? "Unknown";

  let budgetProgressItems: BudgetProgressRow[];
  let totalBudgetCents: number;

  if (period.range === "month") {
    const activeBudgets = Array.from(selectActiveBudgetsByCategory(budgets, period.ym).values());
    budgetProgressItems = buildBudgetProgressRows(activeBudgets, spendByCategory);
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

  const cumulativeSpendGranularity = period.range === "month" ? ("day" as const) : ("month" as const);
  // One month's worth of budget, whatever the selected range: the YTD and lifetime totals
  // sum many months and would overstate a per-month baseline.
  const budgetedMonthlyCents = Array.from(selectActiveBudgetsByCategory(budgets, period.ym).values()).reduce(
    (sum, budget) => sum + budget.limitCents,
    0,
  );
  const spendByPastYm = new Map<string, number>();
  for (const txn of pastExpenseTransactions) {
    const ym = ymdFromDateUtc(txn.date).slice(0, 7);
    spendByPastYm.set(ym, (spendByPastYm.get(ym) ?? 0) + txn.amountCents);
  }
  const monthlyExpected = resolveMonthlyExpected(
    budgetedMonthlyCents,
    pastThreeMonthYms.map((ym) => spendByPastYm.get(ym) ?? 0),
  );
  const cumulativeSpendPoints = buildCumulativeSpendSeries(periodExpenses, {
    range: period.range,
    ym: period.ym,
    todayYmd: currentYmdInTimeZone(user.timezone, now),
    monthlyExpected,
  });

  const categoryPieSlices = Array.from(spendByCategory.entries())
    .map(([categoryId, cents]) => {
      const cat = categories.find((c) => c.id === categoryId);
      return { name: cat?.name ?? "Unknown", cents };
    })
    .filter((s) => s.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

  // The matcher stores the candidate id; the queue needs enough of that transaction to
  // show what it is proposing, so the referenced rows are fetched in one go.
  const matchCandidateIds = stagedRows.map((row) => row.matchTransactionId).filter((id): id is string => Boolean(id));
  const matchCandidates = matchCandidateIds.length
    ? await prisma.transaction.findMany({
        where: { userId: user.id, id: { in: matchCandidateIds } },
        select: { id: true, title: true, amountCents: true, date: true },
      })
    : [];
  const matchCandidateById = new Map(matchCandidates.map((row) => [row.id, row]));

  const expenseCategoryOptionsForQueue = categories
    .filter((c) => c.kind === CategoryKind.EXPENSE)
    .map((c) => ({ id: c.id, name: c.name }));
  const incomeCategoryOptionsForQueue = categories
    .filter((c) => c.kind === CategoryKind.INCOME)
    .map((c) => ({ id: c.id, name: c.name }));

  const reviewRows = stagedRows.map((row) => {
    const candidate = row.matchTransactionId ? matchCandidateById.get(row.matchTransactionId) : undefined;
    const reasons = row.matchReasonsJson ? (JSON.parse(row.matchReasonsJson) as string[]) : [];
    return {
      id: row.id,
      institutionName: row.plaidItem.institutionName ?? "Your bank",
      heading: row.merchantName ?? row.name,
      amountCents: row.amountCents,
      typeLabel: row.type === TransactionType.INCOME ? "Income" : "Expense",
      dateDisplay: formatDateOnlyUtc(row.date),
      accountLabel:
        accounts.find((a) => a.id === row.suggestedAccountId)?.name ?? "Unmapped account",
      categoryOptions:
        row.type === TransactionType.INCOME
          ? incomeCategoryOptionsForQueue
          : expenseCategoryOptionsForQueue,
      suggestedCategoryId: row.suggestedCategoryId ?? "",
      isPending: row.isPending,
      match:
        candidate && row.matchTier
          ? {
              candidate: {
                id: candidate.id,
                title: candidate.title ?? "Untitled",
                amountCents: candidate.amountCents,
                dateDisplay: formatDateOnlyUtc(candidate.date),
              },
              tier: row.matchTier === "high" ? ("high" as const) : ("low" as const),
              reasons,
            }
          : null,
    };
  });

  const revisionCandidateIds = revisedRows
    .map((row) => row.resolvedTransactionId)
    .filter((id): id is string => Boolean(id));
  const revisionTargets = revisionCandidateIds.length
    ? await prisma.transaction.findMany({
        where: { userId: user.id, id: { in: revisionCandidateIds } },
        select: { id: true, amountCents: true },
      })
    : [];
  const revisionTargetById = new Map(revisionTargets.map((row) => [row.id, row]));

  const revisionRows = revisedRows.flatMap((row) => {
    const target = row.resolvedTransactionId ? revisionTargetById.get(row.resolvedTransactionId) : undefined;
    if (!target) return [];
    return [
      {
        id: row.id,
        heading: row.merchantName ?? row.name,
        institutionName: row.plaidItem.institutionName ?? "Your bank",
        approvedAmountCents: target.amountCents,
        bankAmountCents: row.amountCents,
        bankDateDisplay: formatDateOnlyUtc(row.date),
      },
    ];
  });

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
    verification: toVerificationInfo(txn.verification),
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
    verification: toVerificationInfo(txn.verification),
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
    postMode: rule.postMode,
    status: rule.enabled ? getRecurringDateStatus(rule.nextExpectedDate, now) : ("disabled" as const),
  }));

  const toRecentOption = (txn: { id: string; title: string | null; date: Date; amountCents: number }) => ({
    id: txn.id,
    title: txn.title ?? "",
    dateDisplay: formatDateOnlyUtc(txn.date),
    amountCents: txn.amountCents,
  });
  const recentUnlinkedExpenseOptions = recentUnlinkedExpenses.map(toRecentOption);
  const recentUnlinkedIncomeOptions = recentUnlinkedIncomes.map(toRecentOption);

  const recurringForecastPeriod =
    period.range === "ytd"
      ? { start: startOfCalendarYearForYm(period.ym), endExclusive: endExclusiveOfMonthYm(period.ym), label: periodDescription }
      : period.range === "month"
        ? { start: startOfMonthYm(period.ym), endExclusive: endExclusiveOfMonthYm(period.ym), label: periodDescription }
        : { start: startOfMonthYm(anchorYm), endExclusive: endExclusiveOfMonthYm(anchorYm), label: "Current month" };
  const expectedIncomeCents = computeThreeMonthAverageIncomeCents(
    pastThreeMonthYms,
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
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
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

            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end lg:flex-nowrap lg:items-center lg:justify-between">
              <Suspense
                fallback={
                  <span className="text-xs text-slate-500" aria-hidden>
                    Period…
                  </span>
                }
              >
                <DashboardMonthFilter serverAnchorYm={anchorYm} className="w-full sm:max-w-md lg:w-auto lg:max-w-none" />
              </Suspense>
              <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                <BudgetAlertsPanel
                  warnings={budgetWarnings}
                  paceTrends={budgetPaceTrends}
                  momTrends={budgetMomTrends}
                  budgets={budgetProgressItems}
                  periodLabel={periodDescription}
                  periodKey={period.ym}
                />
                <AddFormsDropdown
                  accounts={accountOptions}
                  expenseCategories={expenseCategoryAddOptions}
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
          expenseCategories={expenseCategoryAddOptions}
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
                cumulativeSpend={{
                  periodDescription,
                  points: cumulativeSpendPoints,
                  granularity: cumulativeSpendGranularity,
                  expectedBasis: monthlyExpected?.basis ?? null,
                }}
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
                  recentIncomes={recentUnlinkedIncomeOptions}
                />
              </div>
            </div>
          </div>

          <div className="order-2 flex flex-col gap-4 lg:col-span-7 lg:row-start-1">
            <div className="hidden lg:block">
              <CumulativeSpendCard
                periodDescription={periodDescription}
                points={cumulativeSpendPoints}
                granularity={cumulativeSpendGranularity}
                expectedBasis={monthlyExpected?.basis ?? null}
              />
            </div>
            <section className="hidden rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg sm:p-4 lg:block">
              <h2 className="mb-3 text-lg font-semibold">Add Expense</h2>
              <ExpenseForm
                accounts={accountOptions}
                expenseCategories={expenseCategoryAddOptions}
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
              <PlaidReviewQueue rows={reviewRows} revisions={revisionRows} />
              <ExpenseLogPanel
                entries={expenseLogEntries}
                accounts={accountOptions}
                categories={expenseCategoryOptions}
                titleSuggestions={expenseTitleSuggestions}
                hasLinkedAccounts={plaidItemCount > 0}
              />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
