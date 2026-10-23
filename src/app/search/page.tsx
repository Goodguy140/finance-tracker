import Link from "next/link";
import { TransactionType } from "@prisma/client";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { inputClass, primaryBtnClass, secondaryBtnClass } from "@/components/forms/shared";
import { formatYmLongLabel } from "@/lib/dashboard-period";
import { ymdFromDateUtc } from "@/lib/date-only";
import { homeCurrencyOf, inCurrencyWhere } from "@/lib/home-currency";
import { formatCurrency } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { formatHitAmount } from "@/lib/search/format";
import { shortDateUtc, transactionHit, transactionSearchWhere, TRANSACTION_SEARCH_INCLUDE } from "@/lib/search/search-data";
import { parseSearchTransactionType, searchPageHref, type TransactionSearchFilter } from "@/lib/search/search-paths";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE_SIZE = 50;
const MAX_LIMIT = 1000;
const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";
const labelClass = "space-y-1 text-xs font-medium text-slate-400";

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Every transaction matching a search, from every month: the master search's "See all", and
 * where an account, category or tag found there lists its transactions. A plain GET form, so it
 * works before any script loads and every search has a link of its own.
 */
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [accounts, categories, tags] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, orderBy: [{ archived: "asc" }, { name: "asc" }], select: { id: true, name: true, archived: true } }),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } }),
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Only ids that are the user's own reach the query; anything else is dropped as if unset.
  const pick = <T extends { id: string }>(list: T[], raw: string | undefined) => list.find((x) => x.id === raw)?.id;
  const filter: TransactionSearchFilter = {
    query: firstParam(sp.q)?.trim().slice(0, 100) || undefined,
    accountId: pick(accounts, firstParam(sp.account)),
    categoryId: pick(categories, firstParam(sp.category)),
    tagId: pick(tags, firstParam(sp.tag)),
    type: parseSearchTransactionType(firstParam(sp.type)),
  };
  const hasFilter = Boolean(filter.query || filter.accountId || filter.categoryId || filter.tagId || filter.type);
  const limit = Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, Number(firstParam(sp.limit)) || PAGE_SIZE));

  const homeCurrency = homeCurrencyOf(user.countryCode);
  const where = transactionSearchWhere(user.id, filter);
  const [rows, total, totals] = hasFilter
    ? await Promise.all([
        prisma.transaction.findMany({
          where,
          include: TRANSACTION_SEARCH_INCLUDE,
          orderBy: [{ date: "desc" }, { id: "asc" }],
          take: limit,
        }),
        prisma.transaction.count({ where }),
        // Totals in the home currency only, as everywhere else: there is no conversion.
        prisma.transaction.groupBy({
          by: ["type"],
          where: { AND: [where, inCurrencyWhere(homeCurrency), { type: { not: TransactionType.TRANSFER } }] },
          _sum: { amountCents: true },
        }),
      ])
    : [[], 0, []];
  const spent = totals.find((t) => t.type === TransactionType.EXPENSE)?._sum.amountCents ?? 0;
  const received = totals.find((t) => t.type === TransactionType.INCOME)?._sum.amountCents ?? 0;

  const months: { ym: string; hits: ReturnType<typeof transactionHit>[] }[] = [];
  for (const row of rows) {
    const ym = ymdFromDateUtc(row.date).slice(0, 7);
    const hit = transactionHit(row, homeCurrency, shortDateUtc);
    const last = months.at(-1);
    if (last?.ym === ym) last.hits.push(hit);
    else months.push({ ym, hits: [hit] });
  }

  const describe = [
    filter.query ? `“${filter.query}”` : null,
    filter.type ? { EXPENSE: "expenses", INCOME: "income", TRANSFER: "transfers" }[filter.type] : null,
    filter.accountId ? `on ${accounts.find((a) => a.id === filter.accountId)?.name}` : null,
    filter.categoryId ? `in ${categories.find((c) => c.id === filter.categoryId)?.name}` : null,
    filter.tagId ? `tagged #${tags.find((t) => t.id === filter.tagId)?.name}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <AppNav displayName={user.displayName} countryCode={user.countryCode} />
      <main className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Search transactions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every month at once. Matches the title, note, bank description or an amount such as 12.50.
          </p>
        </div>

        <form method="get" action="/search" className={`${card} grid grid-cols-2 gap-3 sm:grid-cols-6`} role="search">
          <label className={`${labelClass} col-span-2 sm:col-span-6`}>
            <span>Search</span>
            <input
              type="search"
              name="q"
              defaultValue={filter.query ?? ""}
              placeholder="Coffee, rent, 49.99…"
              className={inputClass}
              autoComplete="off"
              maxLength={100}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            <span>Type</span>
            <select name="type" defaultValue={filter.type ?? ""} className={inputClass}>
              <option value="">All</option>
              <option value="EXPENSE">Expenses</option>
              <option value="INCOME">Income</option>
              <option value="TRANSFER">Transfers</option>
            </select>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            <span>Account</span>
            <select name="account" defaultValue={filter.accountId ?? ""} className={inputClass}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            <span>Category</span>
            <select name="category" defaultValue={filter.categoryId ?? ""} className={inputClass}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === "INCOME" ? " (income)" : ""}
                </option>
              ))}
            </select>
          </label>
          {tags.length > 0 ? (
            <label className={`${labelClass} sm:col-span-2`}>
              <span>Tag</span>
              <select name="tag" defaultValue={filter.tagId ?? ""} className={inputClass}>
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="col-span-2 flex items-end gap-2 sm:col-span-6 sm:justify-end">
            {hasFilter ? (
              <Link href="/search" className={secondaryBtnClass}>
                Clear
              </Link>
            ) : null}
            <button type="submit" className={primaryBtnClass}>
              Search
            </button>
          </div>
        </form>

        {hasFilter ? (
          <section aria-labelledby="search-results" className={card}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="search-results" className="text-lg font-semibold" data-testid="search-total">
                {total} {total === 1 ? "transaction" : "transactions"}
                <span className="text-sm font-normal text-slate-400"> · {describe}</span>
              </h2>
              {spent !== 0 || received !== 0 ? (
                <p className="text-sm tabular-nums text-slate-400">
                  {spent !== 0 ? <>Spent {formatCurrency(spent, homeCurrency)}</> : null}
                  {spent !== 0 && received !== 0 ? " · " : null}
                  {received !== 0 ? <>Received {formatCurrency(received, homeCurrency)}</> : null}
                </p>
              ) : null}
            </div>
            {total === 0 ? (
              <p className="text-sm text-slate-400">Nothing matches. Try fewer words, or clear a filter.</p>
            ) : (
              <div className="space-y-4" data-testid="search-results">
                {months.map((month) => (
                  <div key={month.ym}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{formatYmLongLabel(month.ym)}</h3>
                    <ul className="divide-y divide-slate-800 text-sm">
                      {month.hits.map((hit) => (
                        <li key={hit.id}>
                          <Link href={hit.href} className="flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition hover:bg-slate-800/60">
                            <span className="min-w-0">
                              <span className="block truncate text-slate-200">{hit.title}</span>
                              <span className="block truncate text-xs text-slate-500">{hit.detail}</span>
                            </span>
                            <span
                              className={`shrink-0 tabular-nums ${
                                hit.type === "INCOME" ? "text-emerald-300" : hit.type === "TRANSFER" ? "text-sky-200" : "text-slate-200"
                              }`}
                            >
                              {formatHitAmount(hit)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {rows.length < total && limit < MAX_LIMIT ? (
                  <Link
                    href={`${searchPageHref(filter)}${searchPageHref(filter).includes("?") ? "&" : "?"}limit=${limit + PAGE_SIZE}`}
                    scroll={false}
                    className={`${secondaryBtnClass} w-full justify-center`}
                  >
                    Show {Math.min(PAGE_SIZE, total - rows.length)} more
                  </Link>
                ) : rows.length < total ? (
                  <p className="text-xs text-slate-500">Showing the newest {rows.length}. Narrow the search to see older ones.</p>
                ) : null}
              </div>
            )}
          </section>
        ) : (
          <p className="text-sm text-slate-400">
            Tip: press <kbd className="rounded border border-slate-700 px-1 text-xs">Ctrl K</kbd> anywhere to search pages,
            settings and actions as well.
          </p>
        )}
      </main>
    </>
  );
}
