import Link from "next/link";
import { Download } from "lucide-react";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { PrintButton } from "@/components/reports/print-button";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import { getCountryConfig } from "@/lib/country-config";
import { formatYmLongLabel } from "@/lib/dashboard-period";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { yearsWithActivity } from "@/lib/reports";
import { loadActivityBounds, loadReportTxs } from "@/lib/reports/load";
import { buildYearSummary, yearWindow } from "@/lib/reports/year-summary";
import { requireUser } from "@/lib/session";
import { listTags } from "@/lib/tags-server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5 print:border-slate-300 print:bg-white";
const button =
  "touch-manipulation inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 print:hidden";

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Year in review and the year's totals for a tax return: tags, registered accounts. */
export default async function YearEndPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const [activityYears, tags] = await Promise.all([loadActivityBounds(user.id), listTags(prisma, user.id)]);
  const years = yearsWithActivity(activityYears, todayYmd);
  const raw = firstParam(sp.year);
  // Last year by default once there is one: it is the one a tax return is for.
  const year = Number(raw && years.includes(raw) ? raw : (years.find((y) => y < todayYmd.slice(0, 4)) ?? years[0]));
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const fmt = (cents: number) => formatCurrency(cents, currency);
  const window = yearWindow(year, todayYmd);

  const [txs, flows] = await Promise.all([
    loadReportTxs(user.id, new Date(Date.UTC(year - 1, 0, 1)), currency),
    prisma.investmentFlow.findMany({
      where: { userId: user.id, date: { gte: window.start, lt: window.end } },
      select: { accountId: true, date: true, direction: true, amountCents: true, account: { select: { name: true, type: true } } },
    }),
  ]);
  const summary = buildYearSummary({
    year,
    todayYmd,
    txs,
    tags,
    flows: flows.map((f) => ({ ...f, accountName: f.account.name, accountType: f.account.type })),
  });
  const taxTags = summary.tags.filter((t) => t.taxRelated);
  const otherTags = summary.tags.filter((t) => !t.taxRelated);
  const spendingChange =
    summary.previousSpendingCents > 0
      ? Math.round(((summary.spendingCents - summary.previousSpendingCents) / summary.previousSpendingCents) * 100)
      : null;
  const lastDay = new Date(window.end.getTime() - 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <div className="print:hidden">
        <AppNav displayName={user.displayName} countryCode={user.countryCode} />
      </div>
      <main
        className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 print:text-black ${APP_TAB_BAR_PAD_CLASS}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link href="/reports" className="text-sm text-sky-300 hover:text-sky-200 print:hidden">
              Reports
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {summary.toDate ? `${year} so far` : `${year} in review`}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Your year at a glance, and totals to have to hand at tax time. These are your own records, not tax advice.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintButton className={button} />
            <a href={`/api/export/transactions?from=${year}-01-01&to=${lastDay}`} className={button}>
              <Download className="h-4 w-4" aria-hidden />
              CSV for {year}
            </a>
          </div>
        </div>

        <nav aria-label="Year" className="flex flex-wrap gap-2 print:hidden">
          {years.map((y) => (
            <Link
              key={y}
              href={`/reports/year?year=${y}`}
              aria-current={Number(y) === year ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                Number(y) === year
                  ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {y}
            </Link>
          ))}
        </nav>

        <section aria-label="Year totals" data-testid="year-totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {[
            { label: "Income", value: fmt(summary.incomeCents) },
            { label: "Spending", value: fmt(summary.spendingCents) },
            { label: summary.netCents >= 0 ? "Left over" : "Overspent", value: fmt(Math.abs(summary.netCents)) },
            { label: "Entries", value: String(summary.transactionCount) },
          ].map((tile) => (
            <div key={tile.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="text-xs text-slate-400 sm:text-sm">{tile.label}</p>
              <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-xl">{tile.value}</p>
            </div>
          ))}
        </section>

        <section aria-labelledby="year-review" className={card}>
          <h2 id="year-review" className="text-lg font-semibold">
            Year in review
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {spendingChange !== null ? (
              <li>
                Spending was {spendingChange === 0 ? "about the same as" : `${Math.abs(spendingChange)}% ${spendingChange > 0 ? "higher than" : "lower than"}`}{" "}
                the same dates in {year - 1}.
              </li>
            ) : null}
            {summary.biggestMonth ? (
              <li>
                Your biggest month was {formatYmLongLabel(summary.biggestMonth.ym)}, at {fmt(summary.biggestMonth.spendingCents)}.
              </li>
            ) : null}
            {summary.incomeCents > 0 ? (
              <li>
                {summary.netCents >= 0
                  ? `You kept ${Math.round((summary.netCents / summary.incomeCents) * 100)}% of what came in.`
                  : `You spent ${fmt(-summary.netCents)} more than came in.`}
              </li>
            ) : null}
          </ul>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-slate-300">Where it went</h3>
              <ol className="mt-1 space-y-0.5 text-sm" data-testid="year-categories">
                {summary.topCategories.map((c) => (
                  <li key={c.categoryName} className="flex justify-between gap-2 tabular-nums">
                    <span className="truncate text-slate-200">{c.categoryName}</span>
                    <span className="text-slate-300">{fmt(c.cents)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-300">Who you paid most</h3>
              <ol className="mt-1 space-y-0.5 text-sm">
                {summary.topPayees.map((m) => (
                  <li key={m.key} className="flex justify-between gap-2 tabular-nums">
                    <span className="truncate text-slate-200">{m.label}</span>
                    <span className="text-slate-300">{fmt(m.spentCents)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section aria-labelledby="year-tags" className={card}>
          <h2 id="year-tags" className="text-lg font-semibold">
            Totals by tag
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Tag entries like &ldquo;Tax deductible&rdquo;, &ldquo;Donation&rdquo; or &ldquo;Medical&rdquo; through the year
            and their totals land here. Tags that look tax-related are listed first.
          </p>
          {summary.tags.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No tagged entries in {year}.</p>
          ) : (
            <table className="mt-2 w-full text-sm tabular-nums" data-testid="year-tags">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 font-normal">Tag</th>
                  <th className="py-1 text-right font-normal">Entries</th>
                  <th className="py-1 text-right font-normal">Spent</th>
                  <th className="py-1 text-right font-normal">Received</th>
                </tr>
              </thead>
              <tbody>
                {[...taxTags, ...otherTags].map((t) => (
                  <tr key={t.tagId} className="border-t border-slate-800">
                    <td className="py-1.5 pr-2">
                      <Link href={`/reports?period=${year}&tag=${encodeURIComponent(t.tagId)}`} className="text-slate-200 hover:underline">
                        {t.name}
                      </Link>
                      {t.taxRelated ? (
                        <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                          Tax time
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right text-slate-400">{t.count}</td>
                    <td className="py-1.5 text-right text-slate-200">{t.spentCents ? fmt(t.spentCents) : "–"}</td>
                    <td className="py-1.5 text-right text-slate-200">{t.receivedCents ? fmt(t.receivedCents) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="year-registered" className={card}>
          <h2 id="year-registered" className="text-lg font-semibold">
            Registered and investment accounts
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Contributions and withdrawals recorded on the Investments card in {year}. Check them against your slips.
          </p>
          {summary.registered.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">None recorded in {year}.</p>
          ) : (
            <table className="mt-2 w-full text-sm tabular-nums" data-testid="year-registered">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 font-normal">Account</th>
                  <th className="py-1 text-right font-normal">Contributed</th>
                  <th className="py-1 text-right font-normal">Withdrawn</th>
                </tr>
              </thead>
              <tbody>
                {summary.registered.map((r) => (
                  <tr key={r.accountId} className="border-t border-slate-800">
                    <td className="py-1.5 pr-2 text-slate-200">
                      {r.accountName} <span className="text-xs text-slate-500">{formatAccountTypeLabel(r.accountType)}</span>
                    </td>
                    <td className="py-1.5 text-right text-slate-200">{fmt(r.contributedCents)}</td>
                    <td className="py-1.5 text-right text-slate-200">{fmt(r.withdrawnCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
