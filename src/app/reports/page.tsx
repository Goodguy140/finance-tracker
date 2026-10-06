import Link from "next/link";
import { TagFilterSelect } from "@/components/expense-log";
import { CashFlowSankey, IncomeSpendingChart } from "@/components/reports/report-charts";
import { getCountryConfig } from "@/lib/country-config";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
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
import { loadActivityBounds, loadReportTxs } from "@/lib/reports/load";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { resolveTagFilter } from "@/lib/tags";
import { listTags } from "@/lib/tags-server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TOP_MERCHANTS = 15;

const linkBtn =
  "inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800";
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
  const period = resolveReportPeriod(firstParam(sp.period), todayYmd);
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const fmt = (cents: number) => formatCurrency(cents, currency);

  const [loaded, activityYears, tags] = await Promise.all([
    loadReportTxs(user.id, previousYearWindow(period).start),
    loadActivityBounds(user.id),
    listTags(prisma, user.id),
  ]);
  // `?tag=`, as on the dashboard: every view on this page narrows to rows carrying the tag.
  const tagFilter = resolveTagFilter(sp.tag, tags);
  const txs = filterByTag(loaded, tagFilter?.id ?? null);
  const tagQuery = tagFilter ? `tag=${encodeURIComponent(tagFilter.id)}` : "";
  const inPeriod = withinWindow(txs, period);
  const months = incomeVsSpendingByMonth(inPeriod, period.months);
  const flow = cashFlow(inPeriod);
  const yoy = yearOverYearByCategory(txs, period);
  const merchants = merchantSummaries(inPeriod);
  const periodOptions = [
    { key: "12m", label: "Last 12 months" },
    ...yearsWithActivity(activityYears, todayYmd).map((y) => ({ key: y, label: y })),
  ];
  const netCents = flow.incomeCents - flow.spendingCents;
  const periodQuery = period.key === "12m" ? "" : `&period=${period.key}`;
  const maxYoyCents = Math.max(1, ...yoy.rows.flatMap((r) => [r.currentCents, r.previousCents]));
  const comparisonLabel = period.key === "12m" ? "the 12 months before" : `the same dates in ${Number(period.key) - 1}`;

  return (
    <main className="mx-auto mb-4 mt-[max(1rem,env(safe-area-inset-top))] w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reports</h1>
          <p className="mt-1 text-sm text-slate-400">Income and spending only. Transfers between your accounts are left out.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link href="/insights" className={linkBtn}>
            Insights
          </Link>
          <Link href="/" className={linkBtn}>
            Back to dashboard
          </Link>
        </div>
      </div>

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
        {tags.length ? (
          <TagFilterSelect tags={tags} selectedId={tagFilter?.id ?? null} className="block w-40 shrink-0" />
        ) : null}
      </div>
      {tagFilter ? (
        <p className="text-sm text-slate-400" data-testid="report-tag-note">
          Showing only entries tagged <span className="text-slate-200">#{tagFilter.name}</span>.
        </p>
      ) : null}

      <section aria-label="Totals" className="grid grid-cols-3 gap-2 sm:gap-3" data-testid="report-totals">
        {[
          { label: "Income", value: fmt(flow.incomeCents) },
          { label: "Spending", value: fmt(flow.spendingCents) },
          { label: netCents >= 0 ? "Saved" : "Overspent", value: fmt(Math.abs(netCents)) },
        ].map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5 sm:px-4 sm:py-3">
            <p className="text-xs text-slate-400 sm:text-sm">{tile.label}</p>
            <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-xl">{tile.value}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="report-months" className={card}>
        <h2 id="report-months" className="text-lg font-semibold">
          Income vs spending
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-400">
          By month, {period.label.toLowerCase()}.{period.toDate ? " This month is still running." : ""}
        </p>
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
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.ym} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300">{m.label}</td>
                  <td className="py-1 text-right">{fmt(m.incomeCents)}</td>
                  <td className="py-1 text-right">{fmt(m.spendingCents)}</td>
                  <td className={`py-1 text-right ${m.netCents < 0 ? "text-amber-300" : "text-slate-200"}`}>{fmt(m.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
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
        {yoy.rows.length ? (
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

      <section aria-labelledby="report-merchants" className={card}>
        <h2 id="report-merchants" className="text-lg font-semibold">
          Payees
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-400">
          Who you paid most, {period.label.toLowerCase()}. Open one to see everything from that payee.
        </p>
        {merchants.length ? (
          <MerchantList merchants={merchants} fmt={fmt} periodQuery={periodQuery} />
        ) : (
          <p className="text-sm text-slate-500">No payees in this period.</p>
        )}
      </section>
    </main>
  );
}

function MerchantList({
  merchants,
  fmt,
  periodQuery,
}: {
  merchants: ReturnType<typeof merchantSummaries>;
  fmt: (cents: number) => string;
  periodQuery: string;
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
        <span className="shrink-0 tabular-nums text-slate-300">
          {m.spentCents !== 0 ? fmt(m.spentCents) : <span className="text-emerald-300">+{fmt(m.receivedCents)}</span>}
        </span>
      </Link>
    </li>
  );
  const top = merchants.slice(0, TOP_MERCHANTS);
  const rest = merchants.slice(TOP_MERCHANTS);
  return (
    <>
      <ul className="-mx-2 text-sm" data-testid="report-merchants">
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
