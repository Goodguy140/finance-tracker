import { prisma } from "@/lib/prisma";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { computeFinancialScore, SCORE_LOOKBACK_MONTHS, type FinancialScore } from "@/lib/financial-score";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { loadReportTxs } from "@/lib/reports/load";

/**
 * The financial score for one user, as Insights and Reports both show it. It always covers the
 * full months before today and every entry, whatever period or tag the page is filtered to.
 */
export async function loadFinancialScore(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<{ score: FinancialScore; currency: string }> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const since = startOfMonthYm(shiftYm(todayYmd.slice(0, 7), -SCORE_LOOKBACK_MONTHS));
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const [txs, budgets, recurring] = await Promise.all([
    loadReportTxs(user.id, since),
    prisma.budget.findMany({
      where: { userId: user.id },
      select: { categoryId: true, periodMonth: true, limitCents: true, category: { select: { name: true } } },
    }),
    prisma.recurringTransaction.findMany({
      where: { userId: user.id, enabled: true },
      select: { name: true, type: true, amountCents: true, cadence: true, enabled: true, endDate: true },
    }),
  ]);
  const score = computeFinancialScore({
    txs,
    budgets: budgets.map((b) => ({ categoryId: b.categoryId, categoryName: b.category.name, periodMonth: b.periodMonth, limitCents: b.limitCents })),
    recurring,
    todayYmd,
    formatCents: (cents) => formatCurrency(cents, currency),
  });
  return { score, currency };
}
