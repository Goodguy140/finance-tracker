import { getCountryConfig } from "@/lib/country-config";
import { describeOtherCurrencies } from "@/lib/home-currency";
import { loadNetWorth, loadProjectionInputs } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { projectBalances } from "@/lib/projected-balances";
import {
  cashFlow,
  filterByTag,
  incomeVsSpendingByMonth,
  merchantSummaries,
  previousYearWindow,
  resolveReportPeriod,
  withinWindow,
  yearOverYearByCategory,
  yearsWithActivity,
} from "@/lib/reports";
import { loadActivityBounds, loadOtherCurrencyTotals, loadReportTxs, loadSavingsTransfers } from "@/lib/reports/load";
import { savedByTransferByMonth, totalSavedByTransfer } from "@/lib/savings-transfers";

/**
 * The figures on the Reports page (`/reports`) for a period and an optional tag, worked out once
 * for the website and the phone (`GET /api/v1/reports`): totals, income vs spending by month,
 * cash flow, year over year, payees and payers, plus net worth and projected balances, which do
 * not change with the period.
 */

type User = { id: string; countryCode: string; timezone: string | null };

export async function loadReportsOverview(user: User, periodKey: string | undefined, tagId: string | null) {
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const period = resolveReportPeriod(periodKey, todayYmd);
  const currency = getCountryConfig(user.countryCode).defaultCurrency;

  const [loaded, savings, activityYears, netWorth, projectionInputs, otherCurrency] = await Promise.all([
    loadReportTxs(user.id, previousYearWindow(period).start, currency),
    loadSavingsTransfers(user.id, period.start, currency),
    loadActivityBounds(user.id),
    loadNetWorth(user),
    loadProjectionInputs(user.id),
    // Entries on accounts in another currency are in none of the figures; say what they come to.
    loadOtherCurrencyTotals(user.id, currency, { start: period.start, end: period.end, tagId }),
  ]);
  const projection = projectBalances({
    accounts: netWorth.accounts,
    ...projectionInputs,
    todayYmd,
    currentYm: todayYmd.slice(0, 7),
  });
  const otherCurrencyNote = [
    ["income", describeOtherCurrencies(otherCurrency, "income")],
    ["spending", describeOtherCurrencies(otherCurrency, "expense")],
  ]
    .filter(([, text]) => text)
    .map(([label, text]) => `${label} ${text}`)
    .join("; ");

  const txs = filterByTag(loaded, tagId);
  const inPeriod = withinWindow(txs, period);
  // With any account marked "Counts as savings", saved is what moved into those accounts.
  const tracksSavings = savings.savingsAccountIds.size > 0;
  const savingsTxs = savings.txs.filter(
    (tx) => tx.date >= period.start && tx.date < period.end && (!tagId || tx.tagIds?.includes(tagId)),
  );
  const toSavingsCents = tracksSavings ? totalSavedByTransfer(savingsTxs, savings.savingsAccountIds) : null;
  const allMonths = incomeVsSpendingByMonth(
    inPeriod,
    period.months,
    tracksSavings ? savedByTransferByMonth(savingsTxs, savings.savingsAccountIds, period.months) : null,
  );
  // Start at the first month with anything in it, so a short history isn't a row of empty bars.
  const firstActive = allMonths.findIndex((m) => m.incomeCents !== 0 || m.spendingCents !== 0 || (m.toSavingsCents ?? 0) !== 0);
  const months = firstActive === -1 ? [] : allMonths.slice(firstActive);
  const flow = cashFlow(inPeriod, { toSavingsCents });
  const merchants = merchantSummaries(inPeriod);

  return {
    todayYmd,
    currency,
    period,
    periodOptions: [
      { key: "12m", label: "Last 12 months" },
      ...yearsWithActivity(activityYears, todayYmd).map((y) => ({ key: y, label: y })),
    ],
    txs,
    tracksSavings,
    toSavingsCents,
    months,
    flow,
    yoy: yearOverYearByCategory(txs, period),
    // Who you paid and who paid you are listed apart: an employer is not a payee.
    payees: merchants.filter((m) => m.spentCents !== 0),
    payers: merchants.filter((m) => m.spentCents === 0 && m.receivedCents !== 0),
    otherCurrencyNote,
    netWorth,
    projectionInputs,
    projection,
  };
}

export type ReportsOverview = Awaited<ReturnType<typeof loadReportsOverview>>;
