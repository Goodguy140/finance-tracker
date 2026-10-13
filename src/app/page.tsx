import { Suspense } from "react";
import { CategoryKind, PlaidStagedStatus, RecurringCadence, TransactionType } from "@prisma/client";
import Link from "next/link";
import { LogoutButton } from "@/components/forms";
import { DashboardMobileActions } from "@/components/dashboard-mobile-actions";
import { DashboardMonthFilter } from "@/components/dashboard-month-filter";
import { BudgetAlertsPanel } from "@/components/budget-alerts-panel";
import { CumulativeSpendCardBody } from "@/components/cumulative-spend-card";
import { DASHBOARD_CONTAINER_ID, DashboardShell } from "@/components/dashboard-shell";
import type { DashboardCardContentMap } from "@/components/dashboard-grid";
import { BudgetsCardActions, BudgetsCardBody } from "@/components/dashboard-cards/budgets-card";
import { SpendingByCategoryCardBody } from "@/components/dashboard-cards/spending-by-category-card";
import { IncomeCardBody } from "@/components/dashboard-cards/income-card";
import { InsightsCardBody } from "@/components/dashboard-cards/insights-card";
import { RecurringCardActions, RecurringCardBody } from "@/components/dashboard-cards/recurring-card";
import { AddEntryCardBody } from "@/components/dashboard-cards/add-entry-card";
import { BillsForecastCardBody } from "@/components/dashboard-cards/bills-forecast-card";
import { ExpenseLogPanel } from "@/components/expense-log";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import { isRegisteredAccountType } from "@/lib/contribution-room";
import { InvestmentsCardBody, type InvestmentActivityItem } from "@/components/dashboard-cards/investments-card";
import { RefreshLinkedAccountsButton } from "@/components/refresh-linked-accounts";
import { readDashboardLayout } from "@/lib/dashboard-layout/read";
import type { DashboardCardId } from "@/lib/dashboard-layout/schema";
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
import { dateFromYmd, formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import type { VerificationInfo } from "@/components/verified-badge";
import { PlaidReviewQueue } from "@/components/plaid-review-queue";
import { nextReviewQueueLimit, parseReviewQueueLimit } from "@/lib/plaid/review-queue-page";
import { TransferLog, type TransferLogEntry } from "@/components/transfer-log";
import { TransactionRulesProvider } from "@/components/transaction-rules-context";
import { visibleLearnedSuggestions, type RuleTransactionType } from "@/lib/transaction-rules";
import { catchAllCategoryId } from "@/lib/plaid/category-map";
import { outflowCents, untransferredType } from "@/lib/transfer-type";
import { assignTransferPairs, widenDateFilterForPairing } from "@/lib/plaid/transfer-pairing";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import { makeStagedProposer, proposeStagedRowAs, type StagedRuleProposal } from "@/lib/plaid/staged-rules";
import { resolveDisplayName } from "@/lib/plaid/ingest";
import { PLAID_ITEM_NEEDS_ATTENTION_WHERE } from "@/lib/plaid/attention";
import {
  bucketIncomeCentsByYm,
  computeRecurringCashFlowSummary,
  computeThreeMonthAverageIncomeCents,
  getPastMonthYmsBefore,
  getRecurringDateStatus,
  recurringOccurrenceInMonth,
} from "@/lib/recurring-transactions";
import { currentYmdInTimeZone, currentYmInTimeZone } from "@/lib/period-month";
import { loadInsights } from "@/lib/insights/load";
import { prisma } from "@/lib/prisma";
import { resolveTagFilter } from "@/lib/tags";
import { listTags } from "@/lib/tags-server";
import { autoPostDueRecurringTransactions } from "@/lib/recurring-post";
import {
  describeOtherCurrencies,
  foreignCurrencyOf,
  homeCurrencyOf,
  inCurrencyWhere,
  sumOtherCurrencies,
} from "@/lib/home-currency";
import { DEFAULT_BILLS_FORECAST_DAYS, forecastRecurringOccurrences, groupForecastByDay } from "@/lib/bills-forecast";
import { requireUser } from "@/lib/session";
import { paidCentsOf } from "@/lib/owed-shares";
import { OwedToYouList, type OwedToYouItem } from "@/components/owed-to-you";

const cadenceLabels: Record<RecurringCadence, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  BIENNIAL: "Every 2 years",
};

type SearchParams = Promise<{
  month?: string | string[];
  range?: string | string[];
  preset?: string | string[];
  /** A tag id: narrows the logs and Spending by category to transactions carrying it. */
  tag?: string | string[];
  /** How many bank review queue rows to show; grows a page at a time. */
  queue?: string | string[];
}>;

export const dynamic = "force-dynamic";

/** How long a share paid back stays in "Owed to you", where it can still be undone. */
const OWED_PAID_RECENT_DAYS = 30;

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
  // Started now, awaited with the layout: it reads its own year of history, independent of
  // the period on screen. A failure costs the card, never the dashboard.
  const insightsPromise = loadInsights(user.id, user.countryCode).catch((err) => {
    console.error("[insights] loading failed", err);
    return null;
  });
  const anchorYm = currentYmInTimeZone(user.timezone, now);
  // Every total is in this currency. Entries on accounts in another one are still listed, at
  // their own currency, but kept out of the sums: there is no conversion to add them with.
  const homeCurrency = homeCurrencyOf(user.countryCode);
  const homeOnly = inCurrencyWhere(homeCurrency);
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

  const reviewQueueWhere = { userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW, ...transactionDateFilter };
  const reviewQueueLimit = parseReviewQueueLimit(sp.queue);

  const [accounts, categories, budgets, recurringTransactions, stagedRows, reviewQueueTotal, revisedRows, periodExpenses, periodIncomes, incomeTotal, ruleContext, pastIncomeTransactions, pastExpenseTransactions, recentUnlinkedExpenses, recentUnlinkedIncomes, recentExpenseCategoryUsage, recentSplitCategoryUsage, plaidItemCount, plaidAttentionCount, contributionRoom, periodTransfers, periodInvestmentFlows, periodPortfolioSnapshots, transferPairingPool, tags, owedShareRows] =
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
    // The queue follows the period on screen, like the log it sits above.
    // A page at a time (`?queue=` asks for more), with the full count so none goes unseen.
    prisma.plaidStagedTransaction.findMany({
      where: reviewQueueWhere,
      include: { plaidItem: { select: { institutionName: true } } },
      orderBy: [{ date: "desc" }, { name: "asc" }, { id: "asc" }],
      take: reviewQueueLimit,
    }),
    prisma.plaidStagedTransaction.count({ where: reviewQueueWhere }),
    prisma.plaidStagedTransaction.findMany({
      where: { userId: user.id, revisedAfterResolveAt: { not: null }, ...transactionDateFilter },
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
        splitParts: { include: { category: true }, orderBy: { id: "asc" } },
        verification: true,
        tags: { select: { tagId: true } },
        owedShares: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        ...transactionDateFilter,
      },
      include: { category: true, account: true, verification: true, tags: { select: { tagId: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        ...transactionDateFilter,
        ...homeOnly,
      },
      _sum: { amountCents: true },
    }),
    loadRuleContext(user.id),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.INCOME,
        date: {
          gte: startOfMonthYm(pastThreeMonthYms[0]),
          lt: endExclusiveOfMonthYm(recurringIncomeAnchorYm),
        },
        ...homeOnly,
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
        ...homeOnly,
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
    // Banks Plaid has told us need the user (sign in, renew, new accounts). The detail and
    // the fix live on Settings; this only makes sure they find out without going there.
    prisma.plaidItem.count({ where: { userId: user.id, ...PLAID_ITEM_NEEDS_ATTENTION_WHERE } }),
    loadContributionRoomData(user.id),
    // Listed under the expense log, outside every total.
    prisma.transaction.findMany({
      where: { userId: user.id, type: TransactionType.TRANSFER, ...transactionDateFilter },
      include: {
        account: true,
        transferAccount: true,
        verification: true,
        investmentFlow: { select: { id: true } },
        transferPeer: { select: { id: true } },
        tags: { select: { tagId: true } },
      },
      orderBy: { date: "desc" },
    }),
    // The Investments card's activity for the period on screen.
    prisma.investmentFlow.findMany({
      where: { userId: user.id, ...transactionDateFilter },
      include: { account: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.portfolioSnapshot.findMany({
      where: { userId: user.id, ...transactionDateFilter },
      include: { account: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    // Unreviewed bank rows that could be the other side of a transfer in the queue. Wider than
    // the period, so a card paid on the 30th still finds the payment that arrived on the 1st.
    prisma.plaidStagedTransaction.findMany({
      where: {
        userId: user.id,
        status: PlaidStagedStatus.NEEDS_REVIEW,
        ...widenDateFilterForPairing(transactionDateFilter),
      },
      select: {
        id: true,
        suggestedAccountId: true,
        type: true,
        amountCents: true,
        date: true,
        postedDate: true,
        name: true,
        merchantName: true,
        suggestedCategoryId: true,
      },
    }),
    listTags(prisma, user.id),
    // "Owed to you": everything still outstanding whatever the period, since a debt from
    // March is no less owed in May, and what was paid back lately so a slip can be undone.
    prisma.owedShare.findMany({
      where: {
        userId: user.id,
        OR: [{ paidAt: null }, { paidAt: { gte: new Date(now.getTime() - OWED_PAID_RECENT_DAYS * 24 * 60 * 60 * 1000) } }],
      },
      include: { transaction: { select: { title: true, date: true, category: { select: { name: true } } } } },
      orderBy: [{ transaction: { date: "desc" } }, { createdAt: "asc" }],
    }),
  ]);

  // `?tag=`: the logs, their counts and Spending by category show only what carries the tag.
  // Budgets, the spend chart and alerts stay whole — a budget is for all of a category.
  const tagFilter = resolveTagFilter(sp.tag, tags);
  const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
  const tagNamesOf = (txn: { tags: { tagId: string }[] }) =>
    txn.tags.flatMap(({ tagId }) => tagNameById.get(tagId) ?? []).sort((a, b) => a.localeCompare(b));
  const passesTagFilter = (txn: { tags: { tagId: string }[] }) =>
    !tagFilter || txn.tags.some(({ tagId }) => tagId === tagFilter.id);
  const logExpenses = periodExpenses.filter(passesTagFilter);
  const logIncomes = periodIncomes.filter(passesTagFilter);
  const logTransfers = periodTransfers.filter(passesTagFilter);
  const inHomeCurrency = (txn: { account: { currency: string } | null }) => !foreignCurrencyOf(txn.account, homeCurrency);
  const homeExpenses = periodExpenses.filter(inHomeCurrency);
  const homeRecurringRules = recurringTransactions.filter((rule) => rule.account.currency === homeCurrency);
  const otherCurrencyRows = (rows: { type: string; amountCents: number; account: { currency: string } | null }[]) =>
    sumOtherCurrencies(rows.map((txn) => ({ ...txn, currency: foreignCurrencyOf(txn.account, homeCurrency) })));
  // Budgets are for all of a category whatever the tag, so their note is too; the income
  // total follows the tag, so its note does.
  const otherCurrencySpending = describeOtherCurrencies(otherCurrencyRows(periodExpenses), "expense");
  const otherCurrencyIncome = describeOtherCurrencies(otherCurrencyRows(tagFilter ? logIncomes : periodIncomes), "income");

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
  const expenseTitleSuggestions = visibleLearnedSuggestions(ruleContext.learned, ruleContext.hiddenTitleKeys);
  const categoryKindById = new Map(categories.map((c) => [c.id, c.kind as RuleTransactionType]));
  // What the manual forms need to run the rules engine in the browser.
  const formRules = {
    rules: ruleContext.rules.filter((r) => r.enabled),
    categoryKinds: Object.fromEntries(categoryKindById),
    tags,
  };

  const spendByCategory = computeSpendByCategory(homeExpenses);

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
        ...homeOnly,
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

  const currentSpendCents = homeExpenses.reduce((sum, row) => sum + row.amountCents, 0);

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
  const cumulativeSpendPoints = buildCumulativeSpendSeries(homeExpenses, {
    range: period.range,
    ym: period.ym,
    todayYmd: currentYmdInTimeZone(user.timezone, now),
    monthlyExpected,
  });

  const categoryPieSlices = Array.from((tagFilter ? computeSpendByCategory(logExpenses.filter(inHomeCurrency)) : spendByCategory).entries())
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

  const propose = makeStagedProposer(ruleContext, categoryKindById);
  const queueProposalView = (proposal: StagedRuleProposal) => ({
    title: proposal.title,
    note: proposal.note,
    tagNames: proposal.tagIds.flatMap((id) => tagNameById.get(id) ?? []),
    reason: proposal.reason,
  });
  const transferPairs = assignTransferPairs(
    transferPairingPool.map((row) => ({ ...row, accountId: row.suggestedAccountId })),
  );
  const pairingPoolById = new Map(transferPairingPool.map((row) => [row.id, row]));
  const stagedAccountLabel = (accountId: string | null) =>
    accounts.find((a) => a.id === accountId)?.name ?? "Unmapped account";
  const reviewRows = stagedRows.map((row) => {
    const isTransfer = row.type === TransactionType.TRANSFER;
    // What the row becomes if the user unticks "transfer" (or never ticks it): its own type,
    // or for a transfer, spending if the money left and income if it arrived.
    const nonTransferType = isTransfer ? untransferredType(row.amountCents) : row.type;
    // Both ways the row can be booked, each exactly as the commit will write it, so ticking
    // or unticking "transfer" shows what the rules do for that choice.
    const transferProposal = proposeStagedRowAs(propose, row, TransactionType.TRANSFER);
    const nonTransferProposal = proposeStagedRowAs(propose, row, nonTransferType);
    // A rule that marks transfers ticks "transfer" for a row the sync filed as spending or income.
    const offeredAsTransfer = isTransfer || nonTransferProposal.markAsTransfer;
    const proposal = offeredAsTransfer ? transferProposal : nonTransferProposal;
    const nonTransferOptions =
      nonTransferType === TransactionType.INCOME ? incomeCategoryOptionsForQueue : expenseCategoryOptionsForQueue;
    const candidate = row.matchTransactionId ? matchCandidateById.get(row.matchTransactionId) : undefined;
    const reasons = row.matchReasonsJson ? (JSON.parse(row.matchReasonsJson) as string[]) : [];
    return {
      id: row.id,
      institutionName: row.plaidItem.institutionName ?? "Your bank",
      heading: proposal.title,
      bankName: resolveDisplayName(row.name, row.merchantName),
      asTransfer: queueProposalView(transferProposal),
      asNonTransfer: queueProposalView(nonTransferProposal),
      amountCents: row.amountCents,
      isTransfer: offeredAsTransfer,
      dateDisplay: formatDateOnlyUtc(row.date),
      accountLabel: stagedAccountLabel(row.suggestedAccountId),
      transferPair: (() => {
        const peer = pairingPoolById.get(transferPairs.get(row.id) ?? "");
        if (!peer) return null;
        return {
          stagedId: peer.id,
          // Pairing books both legs as transfers, so the peer is named as one.
          heading: proposeStagedRowAs(propose, peer, TransactionType.TRANSFER).title,
          accountLabel: stagedAccountLabel(peer.suggestedAccountId),
          dateDisplay: formatDateOnlyUtc(peer.date),
          // Which way the money went, from this row's side.
          outflow: outflowCents(row.type, row.amountCents) > 0,
        };
      })(),
      nonTransferType: nonTransferType === TransactionType.INCOME ? ("INCOME" as const) : ("EXPENSE" as const),
      categoryOptions: nonTransferOptions,
      suggestedCategoryId:
        nonTransferProposal.categoryId ?? catchAllCategoryId(nonTransferOptions) ?? nonTransferOptions[0]?.id ?? "",
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
        select: { id: true, amountCents: true, owedShares: { select: { amountCents: true } } },
      })
    : [];
  const revisionTargetById = new Map(revisionTargets.map((row) => [row.id, row]));

  const revisionRows = revisedRows.flatMap((row) => {
    const target = row.resolvedTransactionId ? revisionTargetById.get(row.resolvedTransactionId) : undefined;
    // Same amount on both sides: nothing to choose between. Sync no longer raises these, but
    // a row can still get here if the user edited their entry to the bank's amount after the
    // flag was raised, and rows flagged before sync stopped raising them still carry it.
    // What the user paid, like the bank's figure: what others owe was taken out of the amount.
    if (!target || paidCentsOf(target) === row.amountCents) return [];
    return [
      {
        id: row.id,
        heading: resolveDisplayName(row.name, row.merchantName),
        institutionName: row.plaidItem.institutionName ?? "Your bank",
        approvedAmountCents: paidCentsOf(target),
        bankAmountCents: row.amountCents,
        bankDateDisplay: formatDateOnlyUtc(row.date),
      },
    ];
  });

  const expenseLogEntries = logExpenses.map((txn) => ({
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
    // A split's own category is only a label; the lines are where its spending counts.
    categoryLabel:
      txn.splitParts.length > 0
        ? [...new Set(txn.splitParts.map((part) => part.category.name))].join(", ")
        : txn.category.name,
    currency: foreignCurrencyOf(txn.account, homeCurrency),
    isSplit: txn.splitParts.length > 0,
    splitLines: txn.splitParts.map((part) => ({
      id: part.id,
      categoryId: part.categoryId,
      categoryLabel: part.category.name,
      amountCents: part.amountCents,
    })),
    verification: toVerificationInfo(txn.verification),
    owedShares: txn.owedShares.map((share) => ({
      id: share.id,
      name: share.name,
      amountCents: share.amountCents,
      paid: share.paidAt !== null,
    })),
    tags: tagNamesOf(txn),
  }));

  const owedToYouItems: OwedToYouItem[] = owedShareRows.map((share) => ({
    id: share.id,
    name: share.name,
    amountCents: share.amountCents,
    expenseLabel: share.transaction.title?.trim() || share.transaction.category.name,
    expenseDateDisplay: formatDateOnlyUtc(share.transaction.date),
    paidDisplay: share.paidAt ? formatDateOnlyUtc(share.paidAt) : null,
  }));

  const incomeLogEntries = logIncomes.map((txn) => ({
    id: txn.id,
    amountCents: txn.amountCents,
    dateYmd: ymdFromDateUtc(txn.date),
    dateDisplay: formatDateOnlyUtc(txn.date),
    title: txn.title,
    note: txn.note,
    accountId: txn.accountId,
    categoryId: txn.categoryId,
    sourceLabel: txn.category.name,
    currency: foreignCurrencyOf(txn.account, homeCurrency),
    accountLabel: txn.account
      ? `${txn.account.name} (${formatAccountTypeLabel(txn.account.type)})`
      : (txn.accountDescription ?? "Removed account"),
    verification: toVerificationInfo(txn.verification),
    tags: tagNamesOf(txn),
  }));

  // A paired transfer is listed once, from the leg the money left. When only the arriving leg
  // falls in the period (paid on the 30th, arrived on the 1st), that leg stands for the pair.
  const periodTransferIds = new Set(logTransfers.map((txn) => txn.id));
  const transferLogEntries: TransferLogEntry[] = logTransfers
    .filter((txn) => !(txn.transferPeerId && txn.amountCents < 0 && periodTransferIds.has(txn.transferPeerId)))
    .map((txn) => ({
      id: txn.id,
      amountCents: txn.amountCents,
      dateDisplay: formatDateOnlyUtc(txn.date),
      title: txn.title,
      note: txn.note,
      accountId: txn.accountId,
      accountLabel: txn.account
        ? `${txn.account.name} (${formatAccountTypeLabel(txn.account.type)})`
        : (txn.accountDescription ?? "Removed account"),
      transferAccountId: txn.transferAccountId,
      transferAccountLabel: txn.transferAccount
        ? `${txn.transferAccount.name} (${formatAccountTypeLabel(txn.transferAccount.type)})`
        : null,
      paired: txn.transferPeer !== null,
      verification: toVerificationInfo(txn.verification),
      tags: tagNamesOf(txn),
    }));

  // A single month lists only the rules that fall in it: due there, or already posted there
  // (the log for the month holds those). YTD and lifetime list them all, at their next date.
  const recurringIdsPostedInPeriod = new Set(
    [...periodExpenses, ...periodIncomes].map((txn) => txn.recurringTransactionId).filter(Boolean),
  );
  const periodRecurringRules = recurringTransactions.flatMap((rule) => {
    if (period.range !== "month") return [{ rule, occurrence: rule.nextExpectedDate }];
    const occurrence = recurringOccurrenceInMonth(rule, period.ym, anchorYm);
    if (occurrence) return [{ rule, occurrence }];
    return recurringIdsPostedInPeriod.has(rule.id) ? [{ rule, occurrence: rule.nextExpectedDate }] : [];
  });
  const toRecurringListItem = ({ rule, occurrence }: (typeof periodRecurringRules)[number]) => ({
    id: rule.id,
    // Recurring rules are only ever expenses or income (`recurringTransactionSchema`).
    type: rule.type === TransactionType.INCOME ? ("INCOME" as const) : ("EXPENSE" as const),
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
    occurrenceDateYmd: ymdFromDateUtc(occurrence),
    occurrenceDateDisplay: formatDateOnlyUtc(occurrence),
    // An overdue rule carried into this month: the missed occurrence it passes over.
    missedSinceDisplay:
      ymdFromDateUtc(occurrence) > ymdFromDateUtc(rule.nextExpectedDate) ? formatDateOnlyUtc(rule.nextExpectedDate) : null,
    endDateYmd: rule.endDate ? ymdFromDateUtc(rule.endDate) : null,
    endDateDisplay: rule.endDate ? formatDateOnlyUtc(rule.endDate) : null,
    note: rule.note,
    enabled: rule.enabled,
    postMode: rule.postMode,
    status: rule.enabled ? getRecurringDateStatus(occurrence, now) : ("disabled" as const),
  });
  const recurringListItems = periodRecurringRules.map(toRecurringListItem);
  // The rest, at their next date, for the card's "show them" control: a rule due next quarter
  // can still be edited or removed without switching months.
  const periodRecurringIds = new Set(periodRecurringRules.map(({ rule }) => rule.id));
  const recurringOtherItems = recurringTransactions
    .filter((rule) => !periodRecurringIds.has(rule.id))
    .map((rule) => toRecurringListItem({ rule, occurrence: rule.nextExpectedDate }));

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
  const recurringCashFlow = computeRecurringCashFlowSummary(homeRecurringRules, recurringForecastPeriod, {
    expectedIncomeCents,
  });

  const spendVsBudgetLabel =
    period.range === "month"
      ? "Spend vs budgeted"
      : period.range === "ytd"
        ? "YTD spend vs summed budgets"
        : "Lifetime spend vs summed budgets";

  const incomeSumCents = tagFilter
    ? logIncomes.filter(inHomeCurrency).reduce((sum, txn) => sum + txn.amountCents, 0)
    : (incomeTotal._sum.amountCents ?? 0);
  const showDashboardIncomeCard = periodIncomes.length > 0 || (incomeTotal._sum.amountCents ?? 0) > 0;
  const tagFilterLabel = tagFilter ? ` · tagged “${tagFilter.name}”` : "";

  // Which cards this render can produce. The server decides what exists; reconciliation
  // decides where it goes.
  const availableCardIds: DashboardCardId[] = [
    "cumulative-spend",
    "budgets",
    "spending-by-category",
    "add-expense",
    "expense-log",
    "recurring",
    "bills-forecast",
    "insights",
    "investments",
    ...(showDashboardIncomeCard ? (["income"] as const) : []),
  ];
  // Reconciliation is deterministic and runs on every render, so a layout blob that predates
  // a card is harmless — there is no need to write the repaired version back from here, and
  // a render is the wrong place for a write in any case. It is persisted the next time the
  // user changes anything.
  const { stored: storedLayout } = await readDashboardLayout(user.id, availableCardIds);
  const cardSettings = storedLayout.settings;
  const insights = await insightsPromise;

  // Always from today, whatever period is on screen: it answers "what is coming up".
  const billsForecastDays = cardSettings["bills-forecast"]?.days ?? DEFAULT_BILLS_FORECAST_DAYS;
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const tomorrowDate = dateFromYmd(todayYmd);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowYmd = ymdFromDateUtc(tomorrowDate);
  const billsForecast = forecastRecurringOccurrences(homeRecurringRules, {
    todayYmd,
    currentYm: anchorYm,
    days: billsForecastDays,
  });
  const billsForecastDayGroups = groupForecastByDay(billsForecast.occurrences).map((day) => ({
    dateYmd: day.dateYmd,
    label:
      day.dateYmd === todayYmd
        ? "Today"
        : day.dateYmd === tomorrowYmd
          ? "Tomorrow"
          : formatDateOnlyUtc(day.occurrences[0].date),
    runningNetCents: day.runningNetCents,
    items: day.occurrences.map(({ rule, date, overdue, missedSince }) => ({
      key: `${rule.id}:${ymdFromDateUtc(date)}`,
      name: rule.name,
      type: rule.type === TransactionType.INCOME ? ("INCOME" as const) : ("EXPENSE" as const),
      amountCents: rule.amountCents,
      categoryLabel: rule.category.name,
      overdue,
      missedSinceDisplay: missedSince ? formatDateOnlyUtc(missedSince) : null,
    })),
  }));

  // Newest first across the three kinds. A transfer already counted toward room is left out:
  // the contribution recorded from it is in the list, marked as such.
  const investmentActivity: InvestmentActivityItem[] = [
    ...periodInvestmentFlows.map((row) => ({
      kind: "flow" as const,
      id: row.id,
      accountId: row.accountId,
      accountName: row.account.name,
      direction: row.direction,
      amountCents: row.amountCents,
      dateYmd: ymdFromDateUtc(row.date),
      dateDisplay: formatDateOnlyUtc(row.date),
      note: row.note,
      fromTransfer: row.transactionId !== null,
    })),
    ...periodPortfolioSnapshots.map((row) => ({
      kind: "snapshot" as const,
      id: row.id,
      accountId: row.accountId,
      accountName: row.account.name,
      totalValueCents: row.totalValueCents,
      dateYmd: ymdFromDateUtc(row.date),
      dateDisplay: formatDateOnlyUtc(row.date),
      note: row.note,
    })),
    ...periodTransfers.flatMap((row) =>
      row.account && isRegisteredAccountType(row.account.type) && row.amountCents < 0 && !row.investmentFlow
        ? [
            {
              kind: "transfer" as const,
              id: row.id,
              accountName: row.account.name,
              amountCents: row.amountCents,
              dateYmd: ymdFromDateUtc(row.date),
              dateDisplay: formatDateOnlyUtc(row.date),
              title: row.title,
            },
          ]
        : [],
    ),
  ].sort((a, b) => b.dateYmd.localeCompare(a.dateYmd));

  // The slot map: card bodies rendered here, on the server, and handed to the client grid as
  // props. The grid arranges them without importing a single card, so none of this page's
  // query-heavy component tree is pulled into the drag-and-drop bundle.
  const cardContent: DashboardCardContentMap = {
    "cumulative-spend": {
      body: (
        <CumulativeSpendCardBody
          periodDescription={periodDescription}
          points={cumulativeSpendPoints}
          granularity={cumulativeSpendGranularity}
          expectedBasis={monthlyExpected?.basis ?? null}
          chartHeight={cardSettings["cumulative-spend"]?.chartHeight}
          showExpectedLine={cardSettings["cumulative-spend"]?.showExpectedLine}
        />
      ),
    },
    budgets: {
      headerActions: <BudgetsCardActions />,
      body: (
        <BudgetsCardBody
          periodRange={period.range}
          spendVsBudgetLabel={spendVsBudgetLabel}
          currentSpendCents={currentSpendCents}
          totalBudgetCents={totalBudgetCents}
          otherCurrencySpending={otherCurrencySpending}
          budgetProgressItems={budgetProgressItems}
          perRow={cardSettings.budgets?.perRow}
          hideZeroSpend={cardSettings.budgets?.hideZeroSpend}
          showPeriodNote={cardSettings.budgets?.showPeriodNote}
        />
      ),
    },
    "spending-by-category": {
      body: (
        <SpendingByCategoryCardBody
          periodDescription={`${periodDescription}${tagFilterLabel}`}
          categoryPieSlices={categoryPieSlices}
          chartHeight={cardSettings["spending-by-category"]?.chartHeight}
          maxSlices={cardSettings["spending-by-category"]?.maxSlices}
        />
      ),
    },
    "add-expense": {
      body: (
        <AddEntryCardBody
          expense={{
            accounts: accountOptions,
            expenseCategories: expenseCategoryAddOptions,
            defaultExpenseAccountId: user.defaultExpenseAccountId,
            titleSuggestions: expenseTitleSuggestions,
            fieldDefaults: cardSettings["add-expense"],
          }}
          incomeCategories={incomeCategoryOptions}
        />
      ),
    },
    "expense-log": {
      subtitle: `${periodDescription}${tagFilterLabel} · ${logExpenses.length} transaction${logExpenses.length === 1 ? "" : "s"}`,
      // Beside the card's settings button, so it is there whether or not the period has rows.
      // Hidden with no bank connected, when it would have nothing to check.
      headerActions: plaidItemCount > 0 ? <RefreshLinkedAccountsButton /> : undefined,
      body: (
        <>
          {cardSettings["expense-log"]?.showReviewQueue === false ? null : (
            <PlaidReviewQueue
              rows={reviewRows}
              totalCount={reviewQueueTotal}
              nextLimit={nextReviewQueueLimit(reviewRows.length, reviewQueueTotal)}
              revisions={revisionRows}
            />
          )}
          <OwedToYouList items={owedToYouItems} />
          <ExpenseLogPanel
            entries={expenseLogEntries}
            accounts={accountOptions}
            categories={expenseCategoryOptions}
            titleSuggestions={expenseTitleSuggestions}
            tagFilter={{ tags, selectedId: tagFilter?.id ?? null }}
            density={cardSettings["expense-log"]?.density}
            maxHeight={cardSettings["expense-log"]?.maxHeight}
          />
          <TransferLog entries={transferLogEntries} accounts={accountOptions} />
        </>
      ),
    },
    recurring: {
      subtitle: `${period.range === "month" ? `${periodDescription} · ` : ""}${periodRecurringRules.length} rule${periodRecurringRules.length === 1 ? "" : "s"} · due and upcoming first`,
      headerActions: (
        <RecurringCardActions
          accounts={accountOptions}
          expenseCategories={expenseCategoryOptions}
          incomeCategories={incomeCategoryOptions}
          defaultExpenseAccountId={user.defaultExpenseAccountId}
        />
      ),
      body: (
        <RecurringCardBody
          items={recurringListItems}
          accounts={accountOptions}
          expenseCategories={expenseCategoryOptions}
          incomeCategories={incomeCategoryOptions}
          recentExpenses={recentUnlinkedExpenseOptions}
          recentIncomes={recentUnlinkedIncomeOptions}
          cashFlow={recurringCashFlow}
          forecastLabel={recurringForecastPeriod.label}
          showCashFlowSummary={cardSettings.recurring?.showCashFlowSummary}
          rowLimit={cardSettings.recurring?.rowLimit}
          otherItems={recurringOtherItems}
          periodLabel={periodDescription}
        />
      ),
    },
    "bills-forecast": {
      subtitle: `Next ${billsForecastDays} days · from your recurring rules`,
      body: (
        <BillsForecastCardBody
          days={billsForecastDayGroups}
          windowDays={billsForecastDays}
          incomeCents={billsForecast.incomeCents}
          expenseCents={billsForecast.expenseCents}
          netCents={billsForecast.netCents}
          ruleCount={recurringTransactions.filter((rule) => rule.enabled).length}
        />
      ),
    },
    insights: {
      subtitle: "From your last year of transactions",
      body: insights ? (
        <InsightsCardBody insights={insights.visible} maxItems={cardSettings.insights?.maxItems} />
      ) : (
        <p className="text-sm text-slate-400">Insights could not be loaded right now.</p>
      ),
    },
    investments: {
      subtitle: "TFSA, RRSP, FHSA and other investment accounts",
      body: (
        <InvestmentsCardBody
          accounts={accountOptions}
          contributionRoom={contributionRoom}
          activity={investmentActivity}
          periodLabel={periodDescription}
          todayYmd={todayYmd}
          showRoom={cardSettings.investments?.showRoom}
          showForms={cardSettings.investments?.showForms}
          showActivity={cardSettings.investments?.showActivity}
        />
      ),
    },
  };

  // The Income card is omitted entirely in a period with no income. That makes it
  // unrenderable, not removed: reconciliation keeps it in the stored layout so viewing an
  // empty month does not delete it from the user's arrangement.
  if (showDashboardIncomeCard) {
    cardContent.income = {
      body: (
        <IncomeCardBody
          entries={incomeLogEntries}
          accounts={accountOptions}
          categories={incomeCategoryOptions}
          incomeSumCents={incomeSumCents}
          otherCurrencyIncome={otherCurrencyIncome}
          depositCount={logIncomes.length}
          density={cardSettings.income?.density}
          maxHeight={cardSettings.income?.maxHeight}
        />
      ),
    };
  }

  return (
    <TransactionRulesProvider value={formRules}>
    <main data-rendered-at={new Date().toISOString()} className="min-h-screen bg-slate-950 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-0 text-slate-100 lg:p-4 lg:pb-4">
      {/*
        Two columns keep the original reading width; a third or fourth only earns its place
        if the page is allowed to use the display. DashboardShell keeps this in sync when the
        column count changes without a reload.
      */}
      <div
        id={DASHBOARD_CONTAINER_ID}
        className={`mx-auto space-y-3 lg:space-y-4 ${
          storedLayout.columns.length > 2 ? "max-w-[1800px]" : "max-w-7xl"
        }`}
      >
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
                  href="/insights"
                  className="touch-manipulation inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                >
                  Insights
                </Link>
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
                <div className="hidden items-center gap-2 lg:flex">
                  <Link
                    href="/insights"
                    className="touch-manipulation inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
                  >
                    Insights
                  </Link>
                  <Link
                    href="/reports"
                    className="touch-manipulation inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
                  >
                    Reports
                  </Link>
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

        {/* Page-level rather than inside a card: a card body can render twice (grid and tab
            stack) or sit on an inactive tab, and this must be seen exactly once. */}
        {plaidAttentionCount > 0 ? (
          <div
            role="status"
            data-testid="plaid-attention-banner"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100"
          >
            <span>
              {plaidAttentionCount === 1
                ? "A bank connection needs your attention."
                : `${plaidAttentionCount} bank connections need your attention.`}
            </span>
            <Link href="/settings/banks" className="font-medium underline underline-offset-4">
              Review in Settings
            </Link>
          </div>
        ) : null}
        <DashboardShell
          storedLayout={storedLayout}
          cards={cardContent}
          readability={{
            textVisiblePct: user.dashboardTextVisiblePct,
            budgetNameVisiblePct: user.dashboardBudgetNameVisiblePct,
          }}
        />
      </div>
    </main>
    </TransactionRulesProvider>
  );
}
