import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { formatYmLongLabel } from "@/lib/dashboard-period";
import type { YearEndReport } from "@/lib/reports/year-summary-data";

/**
 * `GET /api/v1/reports/year?year=YYYY`: the website's year-end page (`/reports/year`) for the
 * phone, from the same `loadYearEndReport` — the year in review, totals by tag with the
 * tax-looking ones first, and registered accounts' contributions and withdrawals.
 */
export function serializeYearEnd(report: YearEndReport) {
  const { summary } = report;
  return {
    years: report.years,
    year: report.year,
    currency: report.currency,
    /** True while the year is still running: everything is to today. */
    toDate: summary.toDate,
    from: `${report.year}-01-01`,
    to: report.lastDay,
    totals: {
      incomeCents: summary.incomeCents,
      spendingCents: summary.spendingCents,
      netCents: summary.netCents,
      entries: summary.transactionCount,
    },
    /** Spending against the same dates a year before, in percent; null when there was none then. */
    spendingChangePercent: report.spendingChangePercent,
    biggestMonth: summary.biggestMonth
      ? { month: summary.biggestMonth.ym, label: formatYmLongLabel(summary.biggestMonth.ym), spendingCents: summary.biggestMonth.spendingCents }
      : null,
    months: summary.months.map((m) => ({ month: m.ym, label: m.label, incomeCents: m.incomeCents, spendingCents: m.spendingCents })),
    topCategories: summary.topCategories.map((c) => ({ name: c.categoryName, cents: c.cents, changeRatio: c.changeRatio })),
    topPayees: summary.topPayees.map((m) => ({ key: m.key, name: m.label, spentCents: m.spentCents })),
    tags: summary.tags.map((t) => ({
      tagId: t.tagId,
      name: t.name,
      taxRelated: t.taxRelated,
      count: t.count,
      spentCents: t.spentCents,
      receivedCents: t.receivedCents,
    })),
    registered: summary.registered.map((r) => ({
      accountId: r.accountId,
      name: r.accountName,
      typeLabel: formatAccountTypeLabel(r.accountType),
      contributedCents: r.contributedCents,
      withdrawnCents: r.withdrawnCents,
    })),
  };
}
