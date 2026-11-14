import { TransactionType } from "@prisma/client";
import { selectActiveBudgetsByCategory } from "@/lib/active-budgets";
import { computeSpendByCategory } from "@/lib/budget-progress";
import { assignCategoryColors, SAVINGS_SLICE_COLOR } from "@/lib/category-colors";
import { hasGroups, mergeSlicesByGroup } from "@/lib/category-groups";
import { buildCategoryPieSlices, collapseToMaxSlices } from "@/lib/category-pie";
import {
  buildComparisonPace,
  buildCumulativeSpendSeries,
  customRangeIsDaily,
  resolveMonthlyExpected,
  summarizeCumulativeSpend,
  type CumulativeComparison,
} from "@/lib/cumulative-spend";
import { ymdFromDateUtc } from "@/lib/date-only";
import { reconcileDashboardLayout } from "@/lib/dashboard-layout/normalize";
import { readDashboardLayoutJson } from "@/lib/dashboard-layout/read";
import { CARD_IDS } from "@/lib/dashboard-layout/schema";
import { serializeAppPeriod } from "@/lib/api-v1/period";
import {
  endExclusiveOfMonthYm,
  parseDashboardSearchParams,
  startOfMonthYm,
  type ParsedDashboardPeriod,
} from "@/lib/dashboard-period";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { getPastMonthYmsBefore } from "@/lib/recurring-transactions";
import { loadSavingsTransfers } from "@/lib/reports/load";
import { savedByTransferBetween } from "@/lib/savings-transfers";

/**
 * The dashboard's Cumulative spending and Spending by category cards for one month, year to date
 * or a custom range, for the phone app (`GET /api/v1/spending`). Every number comes from the
 * function the card draws it with, so the phone and the website agree to the cent; the phone only
 * draws them.
 */

export const COMPARISONS: readonly CumulativeComparison[] = ["none", "last-month", "three-month-average"];

/** Slices before the rest is rolled into "Other categories", when the card has no setting: the default its settings show. */
export const DEFAULT_MAX_SLICES = 8;

/** The two cards' settings, as the website stores them, with the phone's own choice laid over. */
export type SpendingSettings = {
  compareWith: CumulativeComparison;
  showExpectedLine: boolean;
  showSavings: boolean;
  groupCategories: boolean;
  maxSlices: number;
};

/** What the phone may choose for itself; anything it leaves out follows the website's card. */
export type SpendingChoice = { compareWith?: CumulativeComparison; showSavings?: boolean };

type MonthExpense = {
  date: Date;
  amountCents: number;
  categoryId: string;
  splitParts: { categoryId: string; amountCents: number }[];
};

export type AppSpendingInput = {
  /** The month shown, or the last month of a range. */
  ym: string;
  /** Year to date or a custom range, as the dashboard's period filter has them; a month when left out. */
  period?: ParsedDashboardPeriod;
  todayYmd: string;
  currency: string;
  /** The period's expenses in the home currency, as the dashboard's chart and pie count them. */
  expenses: readonly MonthExpense[];
  /** Home-currency expenses in the three months before `ym`: the expected pace and the comparison draw on them. */
  pastExpenses: readonly { date: Date; amountCents: number }[];
  /** One month of budget: the budgets in force for `ym`, added up. */
  budgetedMonthlyCents: number;
  categories: readonly { id: string; name: string; groupName: string | null; createdAt: Date }[];
  settings: SpendingSettings;
  /** Net moved into savings accounts in the period, and how many accounts count; null when the slice is off. */
  savings: { cents: number; accounts: number } | null;
};

/** The cards' settings from the stored dashboard layout, with the phone's choice winning where it made one. */
export function resolveSpendingSettings(layoutJson: string | null, choice: SpendingChoice): SpendingSettings {
  const settings = reconcileDashboardLayout(layoutJson, CARD_IDS).stored.settings;
  const cumulative = settings["cumulative-spend"] ?? {};
  const pie = settings["spending-by-category"] ?? {};
  return {
    compareWith: choice.compareWith ?? cumulative.compareWith ?? "none",
    showExpectedLine: cumulative.showExpectedLine ?? true,
    showSavings: choice.showSavings ?? pie.showSavings ?? false,
    groupCategories: pie.groupCategories ?? true,
    maxSlices: pie.maxSlices ?? DEFAULT_MAX_SLICES,
  };
}

export function buildAppSpending(input: AppSpendingInput) {
  const { ym, settings } = input;
  const period = input.period ?? parseDashboardSearchParams({ month: ym });
  const isMonth = period.range === "month";

  // Cumulative spending, as the dashboard builds it for a month (`src/app/page.tsx`).
  const spendByPastYm = new Map<string, number>();
  for (const row of input.pastExpenses) {
    const rowYm = ymdFromDateUtc(row.date).slice(0, 7);
    spendByPastYm.set(rowYm, (spendByPastYm.get(rowYm) ?? 0) + row.amountCents);
  }
  const monthlyExpected = settings.showExpectedLine
    ? resolveMonthlyExpected(
        input.budgetedMonthlyCents,
        getPastMonthYmsBefore(ym, 3).map((pastYm) => spendByPastYm.get(pastYm) ?? 0),
      )
    : null;
  // An earlier month's pace is by day of the month, so only a month view compares.
  const compareWith = isMonth ? settings.compareWith : "none";
  const comparisonPace = buildComparisonPace(input.pastExpenses, compareWith, ym);
  const points = buildCumulativeSpendSeries([...input.expenses], {
    range: period.range,
    ym,
    custom: period.custom,
    todayYmd: input.todayYmd,
    monthlyExpected,
    comparisonPace,
  });
  const granularity = isMonth || (period.custom && customRangeIsDaily(period.custom)) ? ("day" as const) : ("month" as const);
  const summary = summarizeCumulativeSpend(points);

  // Spending by category, as the dashboard's pie draws it: groups added up once there are any,
  // the tail rolled into "Other categories", Savings last and never rolled in.
  const slices = buildCategoryPieSlices(computeSpendByCategory([...input.expenses]), input.categories, assignCategoryColors(input.categories));
  const grouped = settings.groupCategories && hasGroups(slices, (slice) => slice.groupName);
  const shown: { name: string; cents: number; color: string; pinned?: boolean; other?: true; categoryId?: string }[] = grouped
    ? mergeSlicesByGroup(slices)
    : slices;
  const savingsCents = input.savings?.cents ?? 0;
  const withSavings =
    savingsCents !== 0 ? [...shown, { name: "Savings", cents: savingsCents, color: SAVINGS_SLICE_COLOR, pinned: true }] : shown;

  return {
    month: ym,
    /** The month, year to date or custom range shown. */
    period: serializeAppPeriod(period),
    today: input.todayYmd,
    currency: input.currency,
    /** The settings this answer was built with, so the phone can show them; none outside a month view. */
    compareWith,
    showSavings: settings.showSavings,
    cumulative: {
      /** What each point is: a day (a month, or a custom range of up to 62 days) or a month. */
      granularity,
      days: points.map((point, index) => ({
        day: index + 1,
        /** The axis label ("6", "Nov 6", "Mar"), then the full one ("Nov 6", "Mar 2026"). */
        label: point.label,
        fullLabel: point.fullLabel,
        spentCents: point.bucketCents,
        // Null for days still to come.
        totalCents: point.cumulativeCents,
        expectedCents: point.expectedCents,
        comparisonCents: point.comparisonCents,
      })),
      totalCents: summary.totalCents,
      expectedBasis: monthlyExpected?.basis ?? null,
      expectedGapCents: summary.gapCents,
      // Null when there was nothing in the earlier months to compare with, or no comparison.
      comparisonGapCents: summary.comparisonGapCents,
    },
    categories: {
      totalCents: slices.reduce((sum, slice) => sum + slice.cents, 0),
      grouped,
      slices: collapseToMaxSlices(withSavings, settings.maxSlices).map((slice) => ({
        name: slice.name,
        cents: slice.cents,
        color: slice.color,
        kind: sliceKind(slice),
        // A category's own slice opens its page on the phone; a group's, the rest and Savings have none.
        ...(!grouped && "categoryId" in slice && slice.categoryId ? { categoryId: slice.categoryId } : {}),
      })),
      savings: input.savings,
    },
  };
}

export type AppSpending = ReturnType<typeof buildAppSpending>;

/** A category (or a group of them), the "Other categories" remainder, or Savings, which is not a category. */
function sliceKind(slice: { pinned?: boolean; other?: true }): "category" | "other" | "savings" {
  if (slice.other) return "other";
  return slice.pinned ? "savings" : "category";
}

type SpendingUser = { id: string; countryCode: string | null; timezone: string | null };

export async function loadAppSpending(
  user: SpendingUser,
  period: ParsedDashboardPeriod,
  choice: SpendingChoice,
  now: Date = new Date(),
): Promise<AppSpending> {
  const { ym } = period;
  const currency = homeCurrencyOf(user.countryCode);
  const monthStart = startOfMonthYm(ym);
  const range = "date" in period.transactionDateFilter ? period.transactionDateFilter.date : { gte: monthStart, lt: endExclusiveOfMonthYm(ym) };
  const homeOnly = inCurrencyWhere(currency);
  const [layoutJson, expenses, pastExpenses, categories, budgets] = await Promise.all([
    readDashboardLayoutJson(user.id),
    prisma.transaction.findMany({
      where: { userId: user.id, type: TransactionType.EXPENSE, date: range, ...homeOnly },
      select: { date: true, amountCents: true, categoryId: true, splitParts: { select: { categoryId: true, amountCents: true } } },
    }),
    // The three months before the last month shown: the expected pace and a month's comparison.
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.EXPENSE,
        date: { gte: startOfMonthYm(getPastMonthYmsBefore(ym, 3)[0]), lt: monthStart },
        ...homeOnly,
      },
      select: { date: true, amountCents: true },
    }),
    prisma.category.findMany({ where: { userId: user.id }, select: { id: true, name: true, groupName: true, createdAt: true } }),
    prisma.budget.findMany({ where: { userId: user.id }, select: { categoryId: true, periodMonth: true, limitCents: true } }),
  ]);
  const settings = resolveSpendingSettings(layoutJson, choice);
  let savings: AppSpendingInput["savings"] = null;
  if (settings.showSavings) {
    const transfers = await loadSavingsTransfers(user.id, range.gte, currency);
    savings = { cents: savedByTransferBetween(transfers, range), accounts: transfers.savingsAccountIds.size };
  }
  return buildAppSpending({
    ym,
    period,
    todayYmd: currentYmdInTimeZone(user.timezone, now),
    currency,
    expenses,
    pastExpenses,
    // One month of budget, whatever the range, as the dashboard's expected line takes it.
    budgetedMonthlyCents: Array.from(selectActiveBudgetsByCategory(budgets, ym).values()).reduce(
      (sum, budget) => sum + budget.limitCents,
      0,
    ),
    categories,
    settings,
    savings,
  });
}
