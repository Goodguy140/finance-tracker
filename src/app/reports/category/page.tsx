import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryKind } from "@prisma/client";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { CategoryTrendChart } from "@/components/reports/report-charts";
import { getCountryConfig } from "@/lib/country-config";
import { shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { parseCustomRangeKey } from "@/lib/date-range";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { categoryTrend, TREND_MONTHS } from "@/lib/reports/category-trend";
import { loadReportTxs } from "@/lib/reports/load";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const linkBtn =
  "inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800";
const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** One category over time: by month against its budget, its usual month, this month's pace, who it went to. */
export default async function CategoryReportPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const id = firstParam(sp.id)?.trim();
  if (!id) notFound();
  const category = await prisma.category.findFirst({
    where: { id, userId: user.id, kind: { in: [CategoryKind.EXPENSE, CategoryKind.INCOME] } },
    select: { id: true, name: true, kind: true, groupName: true },
  });
  if (!category) notFound();
  const period = firstParam(sp.period);
  const periodQuery = period && (/^\d{4}$/.test(period) || parseCustomRangeKey(period)) ? `&period=${period}` : "";
  const backHref = periodQuery ? `/reports?${periodQuery.slice(1)}` : "/reports";

  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const fmt = (cents: number) => formatCurrency(cents, currency);
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const since = startOfMonthYm(shiftYm(todayYmd.slice(0, 7), -(TREND_MONTHS - 1)));
  const [txs, budgets] = await Promise.all([
    loadReportTxs(user.id, since, currency),
    prisma.budget.findMany({ where: { userId: user.id, categoryId: category.id }, select: { periodMonth: true, limitCents: true } }),
  ]);
  const income = category.kind === CategoryKind.INCOME;
  const trend = categoryTrend({ txs, categoryId: category.id, kind: income ? "INCOME" : "EXPENSE", budgets, todayYmd });
  const searchHref = `/search?category=${encodeURIComponent(category.id)}`;

  const tiles = trend
    ? [
        { label: "This month", value: fmt(trend.thisMonth.cents) },
        ...(trend.thisMonth.paceCents !== null ? [{ label: "On pace for", value: fmt(trend.thisMonth.paceCents) }] : []),
        ...(trend.averageCents !== null
          ? [{ label: trend.averageMonths === 1 ? "Last month" : `${trend.averageMonths}-month average`, value: fmt(trend.averageCents) }]
          : []),
        ...(trend.thisMonth.budgetCents !== null ? [{ label: "Budget", value: fmt(trend.thisMonth.budgetCents) }] : []),
      ]
    : [];

  return (
    <>
      <AppNav displayName={user.displayName} countryCode={user.countryCode} />
      <main
        className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="category-name">
              {category.name}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {income ? "Income" : "Spending"} in this category by month
              {category.groupName ? `, in the ${category.groupName} group` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={searchHref} className={linkBtn}>
              All its transactions
            </Link>
            <Link href={backHref} className={linkBtn}>
              Back to reports
            </Link>
          </div>
        </div>

        {!trend ? (
          <p className="text-sm text-slate-400" data-testid="category-trend-empty">
            Nothing has been filed under this category in the last {TREND_MONTHS} months.
          </p>
        ) : (
          <>
            <section aria-label="This month" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" data-testid="category-trend-tiles">
              {tiles.map((tile) => (
                <div key={tile.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5 sm:px-4 sm:py-3">
                  <p className="text-xs text-slate-400 sm:text-sm">{tile.label}</p>
                  <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-xl">{tile.value}</p>
                </div>
              ))}
            </section>

            <section aria-labelledby="category-months" className={card}>
              <h2 id="category-months" className="mb-3 text-lg font-semibold">
                By month
              </h2>
              <CategoryTrendChart data={trend.months} currency={currency} income={income} />
            </section>

            <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
              {trend.payees.length ? (
                <section aria-labelledby="category-payees" className={card}>
                  <h2 id="category-payees" className="mb-2 text-lg font-semibold">
                    {income ? "Top payers" : "Top payees"}
                  </h2>
                  <ul className="space-y-1 text-sm" data-testid="category-payees">
                    {trend.payees.map((p) => (
                      <li key={p.key} className="flex justify-between gap-3">
                        <Link
                          href={`/reports/merchant?key=${encodeURIComponent(p.key)}${periodQuery}`}
                          className="min-w-0 truncate text-sky-300 hover:text-sky-200"
                        >
                          {p.label}
                        </Link>
                        <span className="shrink-0 tabular-nums text-slate-200">
                          {fmt(p.cents)} <span className="text-xs text-slate-500">· {p.count}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section aria-labelledby="category-biggest" className={card}>
                <h2 id="category-biggest" className="mb-2 text-lg font-semibold">
                  {income ? "Largest amounts" : "Biggest purchases"}
                </h2>
                <ul className="divide-y divide-slate-800 text-sm" data-testid="category-biggest">
                  {trend.biggest.map((t) => (
                    <li key={t.id} className="flex items-baseline justify-between gap-3 py-1.5">
                      <span className="min-w-0">
                        <span className="block truncate text-slate-200">{t.title}</span>
                        <span className="block text-xs text-slate-500">
                          {formatDateOnlyUtc(t.date)}
                          {t.split ? " · part of a split" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-200">{fmt(t.cents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}
