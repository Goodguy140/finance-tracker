import { PlaidStagedStatus, TransactionType, type PrismaClient } from "@prisma/client";
import { forecastRecurringOccurrences, type BillsForecastOccurrence } from "@/lib/bills-forecast";
import { buildMonthlyBudgetProgress, budgetRowPercentUsed, type MonthlyBudgetProgress } from "@/lib/budget-progress";
import { ymdFromDateUtc } from "@/lib/date-only";
import { homeCurrencyOf } from "@/lib/home-currency";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { plannedAsForecastRules } from "@/lib/planned-transactions";
import { loadOpenPlannedTransactions } from "@/lib/planned-transactions-data";
import { prisma } from "@/lib/prisma";
import { computeSafeToSpend, type SafeToSpend } from "@/lib/safe-to-spend";
import { loadSafeToSpendInput } from "@/lib/safe-to-spend-data";
import { computeZeroBased, type ZeroBasedSummary } from "@/lib/zero-based";

/**
 * The phone app's Home screen in one call (`GET /api/v1/summary`): safe to spend for the month
 * now running, how the month's budgets stand, bills and pay due in the next week, and what is
 * waiting for the person. Every number comes from the function the website shows it with, so the
 * two agree to the cent.
 */

/** How far ahead "Coming up" looks. */
export const SUMMARY_UPCOMING_DAYS = 7;
/** A budget this far used is one to watch: the line the dashboard's warnings and the email digest draw. */
export const SUMMARY_WATCH_SHARE = 0.8;

type ForecastRow = {
  type: TransactionType;
  amountCents: number;
  name: string;
  planned?: true;
};

export type AppSummaryInput = {
  todayYmd: string;
  currency: string;
  safeToSpend: SafeToSpend;
  /** Set when the person budgets zero-based: the website's card then shows "To assign" instead. */
  zeroBased?: ZeroBasedSummary | null;
  progress: MonthlyBudgetProgress;
  occurrences: readonly BillsForecastOccurrence<ForecastRow>[];
  bankQueueCount: number;
  needsReviewCount: number;
};

export function buildAppSummary(input: AppSummaryInput) {
  const { progress } = input;
  const upcoming = input.occurrences.flatMap(({ rule, date, overdue }) =>
    rule.type === TransactionType.EXPENSE || rule.type === TransactionType.INCOME
      ? [
          {
            date: ymdFromDateUtc(date),
            name: rule.name,
            type: rule.type === TransactionType.INCOME ? ("income" as const) : ("expense" as const),
            amountCents: rule.amountCents,
            overdue,
            planned: rule.planned === true,
          },
        ]
      : [],
  );
  return {
    month: input.todayYmd.slice(0, 7),
    today: input.todayYmd,
    currency: input.currency,
    safeToSpend: input.safeToSpend,
    /** Zero-based budgeting's "To assign" for the month, when it is on; null otherwise. */
    zeroBased: input.zeroBased ?? null,
    budgets: {
      count: progress.budgets.length,
      totalLimitCents: progress.totalLimitCents,
      totalSpentCents: progress.totalSpentCents,
      // Most used first, so the one in most trouble leads.
      watch: progress.budgets
        .filter((row) => row.limitCents > 0 && row.spentCents >= row.limitCents * SUMMARY_WATCH_SHARE)
        .sort((a, b) => b.spentCents / b.limitCents - a.spentCents / a.limitCents)
        .map((row) => ({
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          limitCents: row.limitCents,
          spentCents: row.spentCents,
          percentUsed: budgetRowPercentUsed(row),
        })),
    },
    upcoming: {
      days: SUMMARY_UPCOMING_DAYS,
      items: upcoming,
      billsCents: upcoming.filter((u) => u.type === "expense").reduce((sum, u) => sum + u.amountCents, 0),
      incomeCents: upcoming.filter((u) => u.type === "income").reduce((sum, u) => sum + u.amountCents, 0),
    },
    waiting: { bankQueue: input.bankQueueCount, needsReview: input.needsReviewCount },
  };
}

export type AppSummary = ReturnType<typeof buildAppSummary>;

type SummaryUser = { id: string; countryCode: string | null; timezone: string | null };

export async function loadAppSummary(user: SummaryUser, now: Date = new Date(), client: PrismaClient = prisma): Promise<AppSummary> {
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone, now);
  const ym = todayYmd.slice(0, 7);
  const prefs = await client.user.findUnique({
    where: { id: user.id },
    select: { zeroBasedBudgeting: true, safeToSpendBufferDays: true },
  });
  const [safeInput, progress, rules, plans, bankQueueCount, needsReviewCount] = await Promise.all([
    // One input for both numbers, as the dashboard works them out.
    loadSafeToSpendInput({ ...user, safeToSpendBufferDays: prefs?.safeToSpendBufferDays ?? null }, now, client),
    buildMonthlyBudgetProgress(user.id, ym, client),
    // The home currency's rules, as safe to spend and the Upcoming bills card count them.
    client.recurringTransaction.findMany({
      where: { userId: user.id, enabled: true, account: { currency } },
      select: {
        name: true,
        type: true,
        amountCents: true,
        cadence: true,
        nextExpectedDate: true,
        anchorDay: true,
        secondAnchorDay: true,
        beforeWeekend: true,
        endDate: true,
        enabled: true,
      },
    }),
    loadOpenPlannedTransactions(user.id, { currency }, client),
    client.plaidStagedTransaction.count({ where: { userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW } }),
    client.transaction.count({ where: { userId: user.id, needsReview: true } }),
  ]);
  // A plan dated this week counts as a bill or pay due, as on the website, until the real entry arrives.
  const forecast = forecastRecurringOccurrences(
    [...rules, ...plannedAsForecastRules(plans)],
    { todayYmd, currentYm: ym, days: SUMMARY_UPCOMING_DAYS },
  );
  return buildAppSummary({
    todayYmd,
    currency,
    safeToSpend: computeSafeToSpend(safeInput),
    zeroBased: prefs?.zeroBasedBudgeting ? computeZeroBased(safeInput) : null,
    progress,
    occurrences: forecast.occurrences,
    bankQueueCount,
    needsReviewCount,
  });
}
