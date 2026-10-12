import { prisma } from "@/lib/prisma";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { computeFinancialScore, emergencyFundCents, SCORE_LOOKBACK_MONTHS, type FinancialScore } from "@/lib/financial-score";
import { formatCurrency } from "@/lib/money";
import { computeNetWorth } from "@/lib/net-worth";
import { loadBalanceInputs } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { loadReportTxs, loadSavingsTransfers } from "@/lib/reports/load";
import { savedByTransferByMonth } from "@/lib/savings-transfers";

/**
 * The financial score for one user, as Insights and Reports both show it. It always covers the
 * full months before today and every entry, whatever period or tag the page is filtered to.
 */
/** Every month from `since` through the current one, as `YYYY-MM`. */
function monthsSince(since: Date, todayYmd: string): string[] {
  const out: string[] = [];
  for (let ym = since.toISOString().slice(0, 7); ym <= todayYmd.slice(0, 7); ym = shiftYm(ym, 1)) out.push(ym);
  return out;
}

export async function loadFinancialScore(user: {
  id: string;
  timezone: string | null;
  countryCode: string | null;
}): Promise<{ score: FinancialScore; currency: string }> {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const since = startOfMonthYm(shiftYm(todayYmd.slice(0, 7), -SCORE_LOOKBACK_MONTHS));
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const [txs, savings, budgets, recurring, balances] = await Promise.all([
    loadReportTxs(user.id, since, currency),
    loadSavingsTransfers(user.id, since, currency),
    prisma.budget.findMany({
      where: { userId: user.id },
      select: { categoryId: true, periodMonth: true, limitCents: true, category: { select: { name: true } } },
    }),
    prisma.recurringTransaction.findMany({
      where: { userId: user.id, enabled: true },
      select: { name: true, type: true, amountCents: true, cadence: true, enabled: true, endDate: true },
    }),
    loadBalanceInputs(user.id),
  ]);
  // Each account's latest balance as of today, read the way net worth reads it.
  const latest = new Map(
    computeNetWorth({ ...balances, months: [], todayYmd, currency }).accounts.map((row) => [row.accountId, row.latest?.cents ?? null]),
  );
  const score = computeFinancialScore({
    txs,
    budgets: budgets.map((b) => ({ categoryId: b.categoryId, categoryName: b.category.name, periodMonth: b.periodMonth, limitCents: b.limitCents })),
    recurring,
    todayYmd,
    formatCents: (cents) => formatCurrency(cents, currency),
    toSavingsByMonth:
      savings.savingsAccountIds.size > 0
        ? savedByTransferByMonth(savings.txs, savings.savingsAccountIds, monthsSince(since, todayYmd))
        : null,
    emergencyFundCents: emergencyFundCents(
      balances.accounts.map((a) => ({ ...a, latestCents: latest.get(a.id) ?? null })),
      currency,
    ),
  });
  return { score, currency };
}
