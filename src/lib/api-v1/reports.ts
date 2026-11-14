import { ymdFromDateUtc } from "@/lib/date-only";
import { PROJECTION_DAYS } from "@/lib/projected-balances";
import { reportPeriodParam } from "@/lib/reports";
import type { ReportsOverview } from "@/lib/reports/overview";

/**
 * `GET /api/v1/reports`: the website's Reports page for the phone, from the same
 * `loadReportsOverview`. The period is `?period=12m` (the default), a year (`2025`), or a custom
 * range (`from`/`to`, both days included); `tagId` narrows it to entries with that tag, as
 * `?tag=` does on the website. Net worth over time and projected balances do not change with
 * either.
 */

/** Payees and payers listed, as the website lists its top merchants. */
const TOP_MERCHANTS = 15;

/** The period the query names, as `loadReportsOverview` takes it. */
export function reportsPeriodKey(params: URLSearchParams): string | undefined {
  return reportPeriodParam({
    period: params.get("period") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
}

export function serializeReports(overview: ReportsOverview) {
  const { period, flow, netWorth, projection } = overview;
  const merchant = (m: ReportsOverview["payees"][number]) => ({
    key: m.key,
    name: m.label,
    count: m.count,
    spentCents: m.spentCents,
    receivedCents: m.receivedCents,
    lastDate: ymdFromDateUtc(m.lastDate),
  });
  return {
    currency: overview.currency,
    period: {
      key: period.key,
      label: period.label,
      from: ymdFromDateUtc(period.start),
      /** Last day included. */
      to: ymdFromDateUtc(new Date(period.end.getTime() - 86_400_000)),
      /** It runs to today, so the last month is still going. */
      toDate: period.toDate,
      custom: Boolean(period.custom),
    },
    periodOptions: overview.periodOptions,
    totals: {
      incomeCents: flow.incomeCents,
      spendingCents: flow.spendingCents,
      /** Income less spending: left over, or overspent when negative. */
      netCents: flow.incomeCents - flow.spendingCents,
      /** Net moved into "Counts as savings" accounts; null when none is marked, and saved is then `netCents`. */
      toSavingsCents: overview.toSavingsCents,
    },
    months: overview.months.map((m) => ({
      ym: m.ym,
      label: m.label,
      incomeCents: m.incomeCents,
      spendingCents: m.spendingCents,
      netCents: m.netCents,
      toSavingsCents: m.toSavingsCents,
    })),
    /** Where income came from and where it went, biggest first, as the cash-flow diagram draws it. */
    cashFlow: {
      sources: flow.nodes.filter((n) => n.kind === "income" || n.kind === "refunds" || n.kind === "shortfall").map((n) => ({ name: n.name, kind: n.kind, cents: n.cents })),
      uses: flow.nodes.filter((n) => n.kind === "expense" || n.kind === "savings" || n.kind === "saved").map((n) => ({ name: n.name, kind: n.kind, cents: n.cents })),
    },
    yearOverYear: {
      rows: overview.yoy.rows.map((r) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        currentCents: r.currentCents,
        previousCents: r.previousCents,
        changeRatio: r.changeRatio,
      })),
      currentTotalCents: overview.yoy.currentTotalCents,
      previousTotalCents: overview.yoy.previousTotalCents,
    },
    payees: overview.payees.slice(0, TOP_MERCHANTS).map(merchant),
    payers: overview.payers.slice(0, TOP_MERCHANTS).map(merchant),
    /** What accounts in another currency came to, left out of every figure; empty when none. */
    otherCurrencyNote: overview.otherCurrencyNote,
    netWorth: {
      /** Month-end net worth, oldest first; empty without balances. */
      points: netWorth.points.map((p) => ({ ym: p.ym, label: p.label, netCents: p.netCents, assetsCents: p.assetsCents, liabilitiesCents: p.liabilitiesCents })),
    },
    projection:
      projection.accounts.length === 0
        ? null
        : {
            days: [...PROJECTION_DAYS],
            /** Net worth today, then one per `days`. */
            netCents: projection.netCents,
            includesTransfers: projection.includesTransfers,
            rulesLeftOut: projection.rulesLeftOut,
            accounts: projection.accounts.map((a) => ({
              accountId: a.accountId,
              name: a.name,
              liability: a.liability,
              currentCents: a.currentCents,
              asOf: ymdFromDateUtc(a.asOf),
              projectedCents: a.projectedCents,
              belowZero: a.belowZero ? { date: ymdFromDateUtc(a.belowZero.date), lowestCents: a.belowZero.lowestCents } : null,
            })),
          },
  };
}

export type AppReports = ReturnType<typeof serializeReports>;
