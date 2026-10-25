import Link from "next/link";
import { CalendarCheck, CalendarRange, ChevronRight, Download, Printer } from "lucide-react";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { TagFilterSelect } from "@/components/expense-log";
import { FinancialScoreChip } from "@/components/financial-score-card";
import { CashFlowSankey, IncomeSpendingChart, NetWorthChart } from "@/components/reports/report-charts";
import { ProjectionTransfersToggle } from "@/components/reports/projection-transfers-toggle";
import { loadNetWorth, loadProjectionInputs } from "@/lib/net-worth-data";
import { PROJECTION_DAYS, projectBalances, type ProjectedBalances } from "@/lib/projected-balances";
import { getCountryConfig } from "@/lib/country-config";
import { loadFinancialScore } from "@/lib/financial-score-data";
import { loadInsights } from "@/lib/insights/load";
import { ymdFromDateUtc } from "@/lib/date-only";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import {
  cashFlow,
  filterByTag,
  incomeVsSpendingByMonth,
  merchantSummaries,
  previousYearWindow,
  reportPeriodParam,
  resolveReportPeriod,
  withinWindow,
  yearOverYearByCategory,
  yearsWithActivity,
} from "@/lib/reports";
import { loadActivityBounds, loadOtherCurrencyTotals, loadReportTxs, loadSavingsTransfers } from "@/lib/reports/load";
import { groupYearRows } from "@/lib/category-groups";
import { describeOtherCurrencies } from "@/lib/home-currency";
import { savedByTransferByMonth, totalSavedByTransfer } from "@/lib/savings-transfers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { resolveTagFilter } from "@/lib/tags";
import { listTags } from "@/lib/tags-server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TOP_MERCHANTS = 15;

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";

function reportsHref(periodKey: string, tagQuery: string): string {
  const params = [periodKey === "12m" ? "" : `period=${periodKey}`, tagQuery].filter(Boolean).join("&");
  return params ? `/reports?${params}` : "/reports";
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function formatChange(ratio: number | null): string {
  if (ratio === null) return "new";
  const pct = Math.round(ratio * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const period = resolveReportPeriod(
    reportPeriodParam({ period: firstParam(sp.period), from: firstParam(sp.from), to: firstParam(sp.to) }),
    todayYmd,
  );
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const fmt = (cents: number) => formatCurrency(cents, currency);

  const [loaded, savings, activityYears, tags, financial, netWorth, projectionInputs, insights, categoryGroups] = await Promise.all([
    loadReportTxs(user.id, previousYearWindow(period).start, currency),
    loadSavingsTransfers(user.id, period.start, currency),
    loadActivityBounds(user.id),
    listTags(prisma, user.id),
    loadFinancialScore(user),
    loadNetWorth(user),
    loadProjectionInputs(user.id),
    // For the score card's count of possible gaps in the data, as Insights lists them.
    loadInsights(user.id, user.countryCode, user.timezone),
    prisma.category.findMany({ where: { userId: user.id, groupName: { not: null } }, select: { id: true, groupName: true } }),
  ]);
  const projection = projectBalances({
    accounts: netWorth.accounts,
    ...projectionInputs,
    todayYmd,
    currentYm: todayYmd.slice(0, 7),
  });
  // `?tag=`, as on the dashboard: every view on this page narrows to rows carrying the tag.
  const tagFilter = resolveTagFilter(sp.tag, tags);
  // Entries on accounts in another currency are in none of the figures below; say what they come to.
  const otherCurrency = await loadOtherCurrencyTotals(user.id, currency, {
    start: period.start,
    end: period.end,
    tagId: tagFilter?.id ?? null,
  });
  const otherCurrencyNote = [
    ["income", describeOtherCurrencies(otherCurrency, "income")],
    ["spending", describeOtherCurrencies(otherCurrency, "expense")],
  ]
    .filter(([, text]) => text)
    .map(([label, text]) => `${label} ${text}`)
    .join("; ");
  const txs = filterByTag(loaded, tagFilter?.id ?? null);
  const tagQuery = tagFilter ? `tag=${encodeURIComponent(tagFilter.id)}` : "";
  const inPeriod = withinWindow(txs, period);
  // With any account marked "Counts as savings", saved is what moved into those accounts.
  const tracksSavings = savings.savingsAccountIds.size > 0;
  const savingsTxs = savings.txs.filter(
    (tx) => tx.date >= period.start && tx.date < period.end && (!tagFilter || tx.tagIds?.includes(tagFilter.id)),
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
  const yoy = yearOverYearByCategory(txs, period);
  const groupRows = groupYearRows(yoy.rows, new Map(categoryGroups.map((c) => [c.id, c.groupName])));
  const merchants = merchantSummaries(inPeriod);
  // Who you paid and who paid you are listed apart: an employer is not a payee.
  const payees = merchants.filter((m) => m.spentCents !== 0);
  const payers = merchants.filter((m) => m.spentCents === 0 && m.receivedCents !== 0);
  const periodOptions = [
    { key: "12m", label: "Last 12 months" },
    ...yearsWithActivity(activityYears, todayYmd).map((y) => ({ key: y, label: y })),
  ];
  const netCents = flow.incomeCents - flow.spendingCents;
  const periodQuery = period.key === "12m" ? "" : `&period=${period.key}`;
  const maxYoyCents = Math.max(1, ...yoy.rows.flatMap((r) => [r.currentCents, r.previousCents]));
  const comparisonLabel =
    period.key === "12m"
      ? "the 12 months before"
      : period.custom
        ? "the same dates a year earlier"
        : `the same dates in ${Number(period.key) - 1}`;

  return (
    <>
    <AppNav displayName={user.displayName} countryCode={user.countryCode} tagId={tagFilter?.id} />
    <main className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reports</h1>
          <div className="flex flex-wrap gap-2">
          <Link
            href="/reports/year"
            className="touch-manipulation inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            data-testid="reports-year-link"
          >
            <CalendarRange className="h-4 w-4" aria-hidden />
            Year-end summary
          </Link>
          <Link
            href="/reports/month"
            className="touch-manipulation inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            data-testid="reports-month-link"
          >
            <CalendarCheck className="h-4 w-4" aria-hidden />
            Monthly review
          </Link>
          <Link
            href={reportsHref(period.key, tagQuery).replace("/reports", "/reports/print")}
            className="touch-manipulation inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            data-testid="reports-print-link"
          >
            <Printer className="h-4 w-4" aria-hidden />
            Print and templates
          </Link>
          <a
            href={`/api/export/transactions?from=${ymdFromDateUtc(period.start)}&to=${ymdFromDateUtc(new Date(period.end.getTime() - 86_400_000))}`}
            className="touch-manipulation inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
            data-testid="reports-csv-link"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download CSV
          </a>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {tracksSavings
            ? "Transfers between your accounts are left out, except money moved into accounts that count as savings."
            : "Income and spending only. Transfers between your accounts are left out."}
        </p>
      </div>

      <FinancialScoreChip
        score={financial.score}
        gapCount={insights.visible.filter((i) => i.section === "gap").length}
      />

      <NetWorthSection netWorth={netWorth} fmt={fmt} />

      {projection.accounts.length > 0 ? <ProjectedBalancesSection projection={projection} todayYmd={todayYmd} fmt={fmt} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Report period" className="flex flex-wrap gap-2">
          {periodOptions.map((option) => {
            const active = option.key === period.key;
            return (
              <Link
                key={option.key}
                href={reportsHref(option.key, tagQuery)}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  active
                    ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
        <form action="/reports" className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Custom range">
          {tagFilter ? <input type="hidden" name="tag" value={tagFilter.id} /> : null}
          <label className="sr-only" htmlFor="report-from">
            From
          </label>
          <input
            id="report-from"
            type="date"
            name="from"
            required
            defaultValue={period.custom?.fromYmd ?? ymdFromDateUtc(period.start)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          />
          <span className="text-slate-500">to</span>
          <label className="sr-only" htmlFor="report-to">
            To
          </label>
          <input
            id="report-to"
            type="date"
            name="to"
            required
            defaultValue={period.custom?.toYmd ?? todayYmd}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          />
          <button
            type="submit"
            className={`rounded-full border px-3 py-1 transition ${
              period.custom
                ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {period.custom ? "Change range" : "Custom range"}
          </button>
        </form>
        {tags.length ? (
          <TagFilterSelect tags={tags} selectedId={tagFilter?.id ?? null} className="block w-40 shrink-0" />
        ) : null}
      </div>
      {tagFilter ? (
        <p className="text-sm text-slate-400" data-testid="report-tag-note">
          Showing only entries tagged <span className="text-slate-200">#{tagFilter.name}</span>.
        </p>
      ) : null}

      <section
        aria-label="Totals"
        className={`grid gap-2 sm:gap-3 ${toSavingsCents === null ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}
        data-testid="report-totals"
      >
        {[
          { label: "Income", value: fmt(flow.incomeCents) },
          { label: "Spending", value: fmt(flow.spendingCents) },
          ...(toSavingsCents === null
            ? [{ label: netCents >= 0 ? "Saved" : "Overspent", value: fmt(Math.abs(netCents)) }]
            : [
                { label: netCents >= 0 ? "Left over" : "Overspent", value: fmt(Math.abs(netCents)) },
                { label: toSavingsCents >= 0 ? "Saved" : "Taken from savings", value: fmt(Math.abs(toSavingsCents)) },
              ]),
        ].map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5 sm:px-4 sm:py-3">
            <p className="text-xs text-slate-400 sm:text-sm">{tile.label}</p>
            <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-xl">{tile.value}</p>
          </div>
        ))}
      </section>
      {otherCurrencyNote ? (
        <p className="text-sm text-slate-400" data-testid="report-other-currency">
          Accounts in another currency are left out of these figures: {otherCurrencyNote}.
        </p>
      ) : null}

      <section aria-labelledby="report-months" className={card}>
        <h2 id="report-months" className="text-lg font-semibold">
          Income vs spending
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-400">
          By month, {period.label.toLowerCase()}.{period.toDate ? " This month is still running." : ""}
        </p>
        {months.length === 0 ? (
          <p className="text-sm text-slate-500">No income or spending in this period yet.</p>
        ) : (
        <>
        <IncomeSpendingChart data={months} currency={currency} />
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none text-slate-400">Show as a table</summary>
          <table className="mt-2 w-full tabular-nums">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 font-normal">Month</th>
                <th className="py-1 text-right font-normal">Income</th>
                <th className="py-1 text-right font-normal">Spending</th>
                <th className="py-1 text-right font-normal">Net</th>
                {tracksSavings ? <th className="py-1 text-right font-normal">To savings</th> : null}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.ym} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300">{m.label}</td>
                  <td className="py-1 text-right">{fmt(m.incomeCents)}</td>
                  <td className="py-1 text-right">{fmt(m.spendingCents)}</td>
                  <td className={`py-1 text-right ${m.netCents < 0 ? "text-amber-300" : "text-slate-200"}`}>{fmt(m.netCents)}</td>
                  {m.toSavingsCents !== null ? (
                    <td className={`py-1 text-right ${m.toSavingsCents < 0 ? "text-amber-300" : "text-slate-200"}`}>
                      {fmt(m.toSavingsCents)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        </>
        )}
      </section>

      <section aria-labelledby="report-cash-flow" className={card}>
        <h2 id="report-cash-flow" className="text-lg font-semibold">
          Cash flow
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-400">
          Where income came from and where it went, {period.label.toLowerCase()}. Split expenses count in each part&apos;s category.
        </p>
        <CashFlowSankey flow={flow} currency={currency} />
      </section>

      <section aria-labelledby="report-yoy" className={card}>
        <h2 id="report-yoy" className="text-lg font-semibold">
          Year over year
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-400">
          Spending by category, {period.label.toLowerCase()} against {comparisonLabel}.
        </p>
        {yoy.previousTotalCents === 0 && yoy.rows.length ? (
          <p className="text-sm text-slate-500" data-testid="report-yoy-empty">
            Nothing to compare yet: there is no spending from {comparisonLabel}. This fills in once you have a year of history.
          </p>
        ) : yoy.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" data-testid="report-yoy">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 font-normal">Category</th>
                  <th className="py-1 text-right font-normal">This period</th>
                  <th className="py-1 text-right font-normal">A year earlier</th>
                  <th className="py-1 text-right font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {yoy.rows.map((row) => (
                  <tr key={row.categoryId} className="border-t border-slate-800 align-top">
                    <td className="py-1.5 pr-2">
                      <span className="text-slate-200">{row.categoryName}</span>
                      <span className="mt-1 block space-y-0.5" aria-hidden>
                        <span
                          className="block h-1.5 rounded-full bg-sky-400"
                          style={{ width: `${Math.max(0, (row.currentCents / maxYoyCents) * 100)}%` }}
                        />
                        <span
                          className="block h-1.5 rounded-full bg-slate-500"
                          style={{ width: `${Math.max(0, (row.previousCents / maxYoyCents) * 100)}%` }}
                        />
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-slate-200">{fmt(row.currentCents)}</td>
                    <td className="py-1.5 text-right text-slate-400">{fmt(row.previousCents)}</td>
                    <td className={`py-1.5 text-right ${row.changeCents > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                      {formatChange(row.changeRatio)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-700 font-medium">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right">{fmt(yoy.currentTotalCents)}</td>
                  <td className="py-1.5 text-right text-slate-400">{fmt(yoy.previousTotalCents)}</td>
                  <td className="py-1.5 text-right text-slate-300">
                    {formatChange(
                      yoy.previousTotalCents > 0
                        ? (yoy.currentTotalCents - yoy.previousTotalCents) / yoy.previousTotalCents
                        : null,
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 flex gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-4 rounded-full bg-sky-400" /> This period
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-4 rounded-full bg-slate-500" /> A year earlier
              </span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No spending in either period.</p>
        )}
      </section>

      {groupRows.length ? (
        <section aria-labelledby="report-groups" className={card}>
          <h2 id="report-groups" className="text-lg font-semibold">
            Spending by group
          </h2>
          <p className="mb-3 mt-0.5 text-sm text-slate-400">
            Category groups from Settings → Categories, {period.label.toLowerCase()} against {comparisonLabel}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" data-testid="report-groups">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 font-normal">Group</th>
                  <th className="py-1 text-right font-normal">This period</th>
                  <th className="py-1 text-right font-normal">A year earlier</th>
                  <th className="py-1 text-right font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => (
                  <tr key={row.groupName} className="border-t border-slate-800 align-top">
                    <td className="py-1.5 pr-2">
                      <span className="text-slate-200">{row.groupName}</span>
                      <span className="block text-xs text-slate-500">{row.categoryNames.join(", ")}</span>
                    </td>
                    <td className="py-1.5 text-right text-slate-200">{fmt(row.currentCents)}</td>
                    <td className="py-1.5 text-right text-slate-400">{fmt(row.previousCents)}</td>
                    <td className={`py-1.5 text-right ${row.currentCents > row.previousCents ? "text-amber-300" : "text-emerald-300"}`}>
                      {formatChange(row.changeRatio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="report-merchants" className={card}>
        <h2 id="report-merchants" className="text-lg font-semibold">
          Payees
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-400">
          Who you paid most, {period.label.toLowerCase()}. Open one to see everything from that payee.
        </p>
        {payees.length ? (
          <MerchantList merchants={payees} fmt={fmt} periodQuery={periodQuery} testId="report-merchants" />
        ) : (
          <p className="text-sm text-slate-500">No payees in this period.</p>
        )}
      </section>

      {payers.length ? (
        <section aria-labelledby="report-payers" className={card}>
          <h2 id="report-payers" className="text-lg font-semibold">
            Who paid you
          </h2>
          <p className="mb-3 mt-0.5 text-sm text-slate-400">Where income came from, {period.label.toLowerCase()}.</p>
          <MerchantList merchants={payers} fmt={fmt} periodQuery={periodQuery} testId="report-payers" />
        </section>
      ) : null}
    </main>
    </>
  );
}

function NetWorthSection({ netWorth, fmt }: { netWorth: Awaited<ReturnType<typeof loadNetWorth>>; fmt: (cents: number) => string }) {
  const withBalance = netWorth.accounts.filter((a) => a.latest);
  const missing = netWorth.accounts.length - withBalance.length;
  const otherCurrency = withBalance.filter((a) => !a.counted);
  return (
    <section aria-labelledby="report-net-worth" className={card} data-testid="report-net-worth">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="report-net-worth" className="text-lg font-semibold">
          Net worth
        </h2>
        <span className="flex gap-3">
          {netWorth.accounts.some((a) => a.liability) ? (
            <Link href="/reports/debt" className="text-sm text-sky-300 hover:text-sky-200">
              Debt payoff plan
            </Link>
          ) : null}
          <Link href="/settings/accounts" className="text-sm text-sky-300 hover:text-sky-200">
            Update balances
          </Link>
        </span>
      </div>
      {withBalance.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">
          No balances yet. Linked accounts record theirs with the next bank sync; enter the rest under Settings, Accounts,
          Balances.
        </p>
      ) : (
        <>
          <p className="mb-3 mt-0.5 text-sm text-slate-400">
            What your accounts hold less what you owe, at the end of each month. It doesn&apos;t change with the period or
            tag below.
          </p>
          <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Assets", value: fmt(netWorth.assetsCents) },
              { label: "Owed", value: fmt(netWorth.liabilitiesCents) },
              { label: "Net worth", value: fmt(netWorth.netCents) },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                <p className="text-xs text-slate-400">{tile.label}</p>
                <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-lg">{tile.value}</p>
              </div>
            ))}
          </div>
          {netWorth.points.length > 1 ? <NetWorthChart data={netWorth.points} currency={netWorth.currency} /> : null}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer select-none text-slate-400">By account</summary>
            <ul className="mt-2 divide-y divide-slate-800">
              {withBalance.map((a) => (
                <li key={a.accountId} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-300">
                    {a.name}
                    {a.counted ? null : <span className="ml-2 text-xs text-slate-500">not in the total ({a.currency})</span>}
                  </span>
                  <span className={`shrink-0 tabular-nums ${a.liability ? "text-amber-300" : "text-slate-200"}`}>
                    {a.liability ? "−" : ""}
                    {formatCurrency(a.latest!.cents, a.currency)}
                  </span>
                </li>
              ))}
            </ul>
            {missing > 0 || otherCurrency.length > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                {missing > 0 ? `${missing} account${missing === 1 ? " has" : "s have"} no balance yet and ${missing === 1 ? "is" : "are"} left out. ` : ""}
                {otherCurrency.length > 0 ? "Accounts in another currency are listed but not converted into the total." : ""}
              </p>
            ) : null}
          </details>
        </>
      )}
    </section>
  );
}

/** "Oct 15", or "Oct 15, 2025" when it is not this year. */
function shortDate(date: Date, todayYmd: string): string {
  const sameYear = String(date.getUTCFullYear()) === todayYmd.slice(0, 4);
  return date.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function ProjectedBalancesSection({
  projection,
  todayYmd,
  fmt,
}: {
  projection: ProjectedBalances;
  todayYmd: string;
  fmt: (cents: number) => string;
}) {
  const columns = ["Today", ...PROJECTION_DAYS.map((days) => `${days} days`)];
  const signed = (cents: number, liability: boolean) => (liability && cents !== 0 ? `−${fmt(cents)}` : fmt(cents));
  const monthStartYmd = `${todayYmd.slice(0, 7)}-01`;
  const dips = projection.accounts.filter((a) => a.belowZero);
  return (
    <section aria-labelledby="report-projected-balances" className={card} data-testid="report-projected-balances">
      <h2 id="report-projected-balances" className="text-lg font-semibold">
        Projected balances
      </h2>
      <p className="mb-2 mt-0.5 text-sm text-slate-400">
        Your latest balances with the upcoming recurring bills and income applied to the account each one books to.
        {projection.includesTransfers
          ? " Recurring transfers move money from one account to the other, so they change the accounts but not the total."
          : " Recurring transfers between your accounts don't change the total and are left out."}
      </p>
      <ProjectionTransfersToggle enabled={projection.includesTransfers} />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" data-testid="projected-net-worth">
        {columns.map((label, i) => {
          const cents = projection.netCents[i];
          const change = i === 0 ? null : cents - projection.netCents[0];
          return (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
              <p className="text-xs text-slate-400">{i === 0 ? "Net worth today" : `In ${label}`}</p>
              <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-lg">{fmt(cents)}</p>
              {change !== null ? (
                <p className={`text-xs tabular-nums ${change >= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                  {change >= 0 ? "+" : "−"}
                  {fmt(Math.abs(change))}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {dips.length > 0 ? (
        <ul className="mb-3 space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200" data-testid="projected-below-zero">
          {dips.map((a) => (
            <li key={a.accountId}>
              {a.name} goes below zero on {shortDate(a.belowZero!.date, todayYmd)} and reaches {fmt(a.belowZero!.lowestCents)}.
            </li>
          ))}
        </ul>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer select-none text-slate-400">By account</summary>
        <div className="-mx-1 mt-2 overflow-x-auto">
          <table className="w-full text-right text-xs tabular-nums sm:text-sm" data-testid="projected-accounts">
            <thead className="text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-1 py-1 text-left font-normal">
                  Account
                </th>
                {columns.map((label) => (
                  <th key={label} scope="col" className="px-1 py-1 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {projection.accounts.map((a) => {
                const asOfYmd = ymdFromDateUtc(a.asOf);
                return (
                  <tr key={a.accountId}>
                    <th scope="row" className="px-1 py-1.5 text-left font-normal text-slate-300">
                      {a.name}
                      {asOfYmd < monthStartYmd ? (
                        <span className="block text-xs text-slate-500">balance from {shortDate(a.asOf, todayYmd)}</span>
                      ) : null}
                    </th>
                    {[a.currentCents, ...a.projectedCents].map((cents, i) => (
                      <td
                        key={columns[i]}
                        className={`px-1 py-1.5 ${a.liability ? "text-amber-300" : cents < 0 ? "text-red-300" : "text-slate-200"}`}
                      >
                        {signed(cents, a.liability)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {projection.rulesLeftOut > 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {projection.rulesLeftOut} recurring rule{projection.rulesLeftOut === 1 ? " is" : "s are"} on an account with no
            balance or in another currency and {projection.rulesLeftOut === 1 ? "is" : "are"} left out.
          </p>
        ) : null}
        {projection.transfersLeftOut > 0 ? (
          <p className="mt-2 text-xs text-slate-500" data-testid="projected-transfers-left-out">
            {projection.transfersLeftOut} recurring transfer{projection.transfersLeftOut === 1 ? " is" : "s are"} left out:
            both accounts need a balance in this currency, and the rule needs an account to transfer to.
          </p>
        ) : null}
      </details>
    </section>
  );
}

function MerchantList({
  merchants,
  fmt,
  periodQuery,
  testId,
}: {
  merchants: ReturnType<typeof merchantSummaries>;
  fmt: (cents: number) => string;
  periodQuery: string;
  testId: string;
}) {
  const row = (m: (typeof merchants)[number]) => (
    <li key={m.key}>
      <Link
        href={`/reports/merchant?key=${encodeURIComponent(m.key)}${periodQuery}`}
        className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-slate-800/70"
      >
        <span className="min-w-0 truncate text-slate-200">
          {m.label}
          <span className="ml-2 text-xs text-slate-500">
            {m.count} {m.count === 1 ? "entry" : "entries"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums text-slate-300">
          {m.spentCents !== 0 ? fmt(m.spentCents) : <span className="text-emerald-300">+{fmt(m.receivedCents)}</span>}
          <ChevronRight className="h-4 w-4 self-center text-slate-500" aria-hidden />
        </span>
      </Link>
    </li>
  );
  const top = merchants.slice(0, TOP_MERCHANTS);
  const rest = merchants.slice(TOP_MERCHANTS);
  return (
    <>
      <ul className="-mx-2 text-sm" data-testid={testId}>
        {top.map(row)}
      </ul>
      {rest.length ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer select-none text-slate-400">{rest.length} more</summary>
          <ul className="-mx-2 mt-1">{rest.map(row)}</ul>
        </details>
      ) : null}
    </>
  );
}
