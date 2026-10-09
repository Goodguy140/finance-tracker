import Link from "next/link";
import { notFound } from "next/navigation";
import { MerchantMonthChart } from "@/components/reports/report-charts";
import { getCountryConfig } from "@/lib/country-config";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { formatCurrency } from "@/lib/money";
import { merchantActivity } from "@/lib/reports";
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

/** Everything from one payee, across all of the user's history. */
export default async function MerchantReportPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const key = firstParam(sp.key)?.trim();
  if (!key) notFound();
  const period = firstParam(sp.period);
  const backHref = period && /^\d{4}$/.test(period) ? `/reports?period=${period}` : "/reports";

  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const fmt = (cents: number) => formatCurrency(cents, currency);
  const activity = merchantActivity(await loadReportTxs(user.id, null, currency), key);
  if (!activity) notFound();

  const expenseCount = activity.transactions.filter((t) => t.type === "EXPENSE").length;
  const tiles = [
    { label: "Spent", value: fmt(activity.spentCents) },
    ...(activity.receivedCents !== 0 ? [{ label: "Received", value: fmt(activity.receivedCents) }] : []),
    { label: "Entries", value: String(activity.count) },
    ...(expenseCount > 0 ? [{ label: "Average", value: fmt(Math.round(activity.spentCents / expenseCount)) }] : []),
  ];

  return (
    <main className="mx-auto mb-4 mt-[max(1rem,env(safe-area-inset-top))] w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="merchant-name">
            {activity.label}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Everything from this payee, {formatDateOnlyUtc(activity.firstDate)} to {formatDateOnlyUtc(activity.lastDate)}.
          </p>
        </div>
        <Link href={backHref} className={linkBtn}>
          Back to reports
        </Link>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5 sm:px-4 sm:py-3">
            <p className="text-xs text-slate-400 sm:text-sm">{tile.label}</p>
            <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-xl">{tile.value}</p>
          </div>
        ))}
      </section>

      {activity.months.length > 1 ? (
        <section aria-labelledby="merchant-months" className={card}>
          <h2 id="merchant-months" className="mb-3 text-lg font-semibold">
            By month
          </h2>
          <MerchantMonthChart data={activity.months} currency={currency} />
        </section>
      ) : null}

      {activity.categories.length > 1 ? (
        <section aria-labelledby="merchant-categories" className={card}>
          <h2 id="merchant-categories" className="mb-2 text-lg font-semibold">
            Categories
          </h2>
          <ul className="space-y-1 text-sm">
            {activity.categories.map((c) => (
              <li key={c.categoryName} className="flex justify-between gap-3">
                <span className="text-slate-300">{c.categoryName}</span>
                <span className="tabular-nums text-slate-200">{fmt(c.spentCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="merchant-transactions" className={card}>
        <h2 id="merchant-transactions" className="mb-2 text-lg font-semibold">
          Transactions
        </h2>
        <ul className="divide-y divide-slate-800 text-sm" data-testid="merchant-transactions">
          {activity.transactions.map((t) => (
            <li key={t.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate text-slate-200">{t.title || t.merchantName}</span>
                <span className="block text-xs text-slate-500">
                  {formatDateOnlyUtc(t.date)} · {t.splits.length ? "Split" : t.categoryName}
                </span>
              </span>
              <span className={`shrink-0 tabular-nums ${t.type === "INCOME" ? "text-emerald-300" : "text-slate-200"}`}>
                {t.type === "INCOME" ? "+" : ""}
                {fmt(t.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
