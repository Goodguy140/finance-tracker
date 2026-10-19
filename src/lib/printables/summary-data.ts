import { CategoryKind } from "@prisma/client";
import { DEFAULT_BILLS_FORECAST_DAYS, forecastRecurringOccurrences } from "@/lib/bills-forecast";
import { buildMonthlyBudgetProgress, type MonthlyBudgetProgress } from "@/lib/budget-progress";
import { assignCategoryColors, categoryColor } from "@/lib/category-colors";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import {
  computeRoomYear,
  REGISTERED_ACCOUNT_TYPES,
  roomFlowsFromData,
  roomYearFor,
  type RegisteredAccountType,
  type RoomYear,
} from "@/lib/contribution-room";
import { getCountryConfig } from "@/lib/country-config";
import { dateFromYmd } from "@/lib/date-only";
import type { FinancialScore } from "@/lib/financial-score";
import { loadFinancialScore } from "@/lib/financial-score-data";
import { describeOtherCurrencies } from "@/lib/home-currency";
import type { NetWorth } from "@/lib/net-worth";
import { loadNetWorth, loadProjectionInputs } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { projectBalances, type ProjectedBalances } from "@/lib/projected-balances";
import {
  cashFlow,
  filterByTag,
  incomeVsSpendingByMonth,
  merchantSummaries,
  previousYearWindow,
  resolveReportPeriod,
  withinWindow,
  yearOverYearByCategory,
  type MerchantSummary,
  type MonthFlow,
} from "@/lib/reports";
import { loadOtherCurrencyTotals, loadReportTxs, loadSavingsTransfers } from "@/lib/reports/load";
import { loadSavingsGoals, type SavingsGoalView } from "@/lib/savings-goals-data";
import { savedByTransferByMonth, totalSavedByTransfer } from "@/lib/savings-transfers";
import { resolveTagFilter } from "@/lib/tags";
import { listTags } from "@/lib/tags-server";

/** Payees listed in the summary; the rest are summed into one line. */
export const SUMMARY_TOP_PAYEES = 12;

export type SummaryCategoryRow = {
  categoryId: string;
  name: string;
  color: string;
  currentCents: number;
  previousCents: number;
  changeRatio: number | null;
};

export type SummaryBill = {
  date: Date;
  name: string;
  type: "EXPENSE" | "INCOME";
  amountCents: number;
  accountName: string;
  overdue: boolean;
};

/**
 * Everything the printable summary shows, already worked out by the same functions the Reports,
 * Insights and dashboard pages use, so the paper copy and the screens agree.
 */
export type SummaryData = {
  displayName: string;
  currency: string;
  todayYmd: string;
  period: { key: string; label: string; toDate: boolean };
  comparisonLabel: string;
  tagName: string | null;
  /** What accounts in other currencies come to, which none of the totals include; "" when none. */
  otherCurrencyNote: string;
  totals: { incomeCents: number; spendingCents: number; netCents: number; toSavingsCents: number | null };
  months: MonthFlow[];
  categories: SummaryCategoryRow[];
  previousSpendingCents: number;
  payees: MerchantSummary[];
  budgets: MonthlyBudgetProgress;
  score: FinancialScore;
  netWorth: NetWorth;
  projection: ProjectedBalances;
  goals: SavingsGoalView[];
  bills: { days: number; items: SummaryBill[]; incomeCents: number; expenseCents: number; netCents: number };
  contributionRoom: RoomYear[];
};

type SummaryUser = { id: string; displayName: string; timezone: string | null; countryCode: string | null };

export async function loadSummaryData(
  user: SummaryUser,
  options: { period?: string; tag?: string | null },
): Promise<SummaryData> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currentYm = todayYmd.slice(0, 7);
  const period = resolveReportPeriod(options.period, todayYmd);
  const currency = getCountryConfig(user.countryCode).defaultCurrency;

  const tags = await listTags(prisma, user.id);
  const tagFilter = resolveTagFilter(options.tag ?? undefined, tags);
  const tagId = tagFilter?.id ?? null;

  const [loaded, savings, financial, netWorth, projectionInputs, goals, budgets, roomData, categories, recurring, otherCurrency] =
    await Promise.all([
      loadReportTxs(user.id, previousYearWindow(period).start, currency),
      loadSavingsTransfers(user.id, period.start, currency),
      loadFinancialScore(user),
      loadNetWorth(user),
      loadProjectionInputs(user.id),
      loadSavingsGoals(user),
      buildMonthlyBudgetProgress(user.id, currentYm),
      loadContributionRoomData(user.id),
      prisma.category.findMany({ where: { userId: user.id }, select: { id: true, createdAt: true, kind: true } }),
      prisma.recurringTransaction.findMany({
        where: { userId: user.id, enabled: true, type: { in: ["EXPENSE", "INCOME"] } },
        select: {
          name: true,
          type: true,
          amountCents: true,
          cadence: true,
          nextExpectedDate: true,
          anchorDay: true,
          endDate: true,
          enabled: true,
          account: { select: { name: true, currency: true } },
        },
      }),
      loadOtherCurrencyTotals(user.id, currency, { start: period.start, end: period.end, tagId }),
    ]);

  const txs = filterByTag(loaded, tagId);
  const inPeriod = withinWindow(txs, period);
  const tracksSavings = savings.savingsAccountIds.size > 0;
  const savingsTxs = savings.txs.filter(
    (tx) => tx.date >= period.start && tx.date < period.end && (!tagId || tx.tagIds?.includes(tagId)),
  );
  const toSavingsCents = tracksSavings ? totalSavedByTransfer(savingsTxs, savings.savingsAccountIds) : null;
  const months = incomeVsSpendingByMonth(
    inPeriod,
    period.months,
    tracksSavings ? savedByTransferByMonth(savingsTxs, savings.savingsAccountIds, period.months) : null,
  );
  const flow = cashFlow(inPeriod, { toSavingsCents });
  const yoy = yearOverYearByCategory(txs, period);
  const colors = assignCategoryColors(categories.filter((c) => c.kind === CategoryKind.EXPENSE));

  // The dashboard's Upcoming bills card: bills and income on home-currency accounts.
  const forecast = forecastRecurringOccurrences(
    recurring.filter((rule) => rule.account.currency === currency),
    { todayYmd, currentYm, days: DEFAULT_BILLS_FORECAST_DAYS },
  );

  const roomFlows = roomFlowsFromData(roomData);
  const heldTypes = new Set<RegisteredAccountType>([...Object.values(roomData.accountTypes), ...roomData.entries.map((e) => e.accountType)]);
  const today = dateFromYmd(todayYmd);

  const otherCurrencyNote = [
    ["income", describeOtherCurrencies(otherCurrency, "income")],
    ["spending", describeOtherCurrencies(otherCurrency, "expense")],
  ]
    .filter(([, text]) => text)
    .map(([label, text]) => `${label} ${text}`)
    .join("; ");

  return {
    displayName: user.displayName,
    currency,
    todayYmd,
    period: { key: period.key, label: period.label, toDate: period.toDate },
    comparisonLabel: period.key === "12m" ? "the 12 months before" : `the same dates in ${Number(period.key) - 1}`,
    tagName: tagFilter?.name ?? null,
    otherCurrencyNote,
    totals: {
      incomeCents: flow.incomeCents,
      spendingCents: flow.spendingCents,
      netCents: flow.incomeCents - flow.spendingCents,
      toSavingsCents,
    },
    months,
    categories: yoy.rows.map((row) => ({
      categoryId: row.categoryId,
      name: row.categoryName,
      color: categoryColor(colors, row.categoryId),
      currentCents: row.currentCents,
      previousCents: row.previousCents,
      changeRatio: row.changeRatio,
    })),
    previousSpendingCents: yoy.previousTotalCents,
    payees: merchantSummaries(inPeriod),
    budgets,
    score: financial.score,
    netWorth,
    projection: projectBalances({ accounts: netWorth.accounts, ...projectionInputs, todayYmd, currentYm }),
    goals: goals.goals,
    bills: {
      days: DEFAULT_BILLS_FORECAST_DAYS,
      items: forecast.occurrences.map((o) => ({
        date: o.date,
        name: o.rule.name,
        type: o.rule.type as "EXPENSE" | "INCOME",
        amountCents: o.rule.amountCents,
        accountName: o.rule.account.name,
        overdue: o.overdue,
      })),
      incomeCents: forecast.incomeCents,
      expenseCents: forecast.expenseCents,
      netCents: forecast.netCents,
    },
    contributionRoom: REGISTERED_ACCOUNT_TYPES.filter((t) => heldTypes.has(t)).map((t) =>
      computeRoomYear(t, roomYearFor(t, today), roomData.entries, roomFlows),
    ),
  };
}
