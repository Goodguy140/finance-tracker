import Link from "next/link";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { MonthCloseButton } from "@/components/reports/month-close-button";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { endExclusiveOfMonthYm, formatYmLongLabel, shiftYm, startOfMonthYm } from "@/lib/dashboard-period";
import { dateFromYmd, formatDateOnlyUtc } from "@/lib/date-only";
import { homeCurrencyOf } from "@/lib/home-currency";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone, isValidYm } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { loadReportTxs } from "@/lib/reports/load";
import { buildMonthRecap, defaultRecapYm } from "@/lib/reports/month-recap";
import { requireUser } from "@/lib/session";
import { PlaidStagedStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";
const navButton =
  "touch-manipulation inline-flex min-h-9 items-center rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800";

function pctChange(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return "about the same as";
  return `${Math.abs(pct)}% ${pct > 0 ? "more than" : "less than"}`;
}

/** The monthly review and close: one month's recap, then a "mark month closed" step. */
export default async function MonthReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const currentYm = todayYmd.slice(0, 7);
  const raw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const ym = raw && isValidYm(raw) && raw <= currentYm ? raw : defaultRecapYm(todayYmd);
  const currency = homeCurrencyOf(user.countryCode);
  const fmt = (cents: number) => formatCurrency(cents, currency);
  const range = { gte: startOfMonthYm(ym), lt: endExclusiveOfMonthYm(ym) };

  const [txs, progress, categories, needsReview, closed, unreviewedPosted, scores] = await Promise.all([
    loadReportTxs(user.id, startOfMonthYm(shiftYm(ym, -1)), currency),
    buildMonthlyBudgetProgress(user.id, ym),
    prisma.category.findMany({ where: { userId: user.id }, select: { id: true, rolloverSinceMonth: true } }),
    prisma.plaidStagedTransaction.count({
      where: { userId: user.id, status: PlaidStagedStatus.NEEDS_REVIEW, date: range },
    }),
    prisma.monthClose.findUnique({ where: { userId_ym: { userId: user.id, ym } } }),
    // Imported, auto-posted or API rows nobody has looked at (the log's Needs review filter).
    prisma.transaction.count({ where: { userId: user.id, needsReview: true, date: range } }),
    // The financial score as saved for this month and the one before (`FinancialScoreSnapshot`).
    prisma.financialScoreSnapshot.findMany({
      where: { userId: user.id, month: { in: [ym, shiftYm(ym, -1)] } },
      select: { month: true, score: true },
    }),
  ]);
  const scoreNow = scores.find((s) => s.month === ym) ?? null;
  const scoreBefore = scores.find((s) => s.month === shiftYm(ym, -1)) ?? null;
  const rolloverOn = new Set(
    categories.filter((c) => c.rolloverSinceMonth !== null && c.rolloverSinceMonth <= ym).map((c) => c.id),
  );
  const rolloverByName = new Map(progress.budgets.map((b) => [b.categoryName, rolloverOn.has(b.categoryId)]));
  const recap = buildMonthRecap({
    ym,
    txs,
    budgets: progress.budgets.map((b) => ({
      categoryName: b.categoryName,
      spentCents: b.spentCents,
      limitCents: b.limitCents,
      carryCents: b.carryCents,
    })),
  });
  const label = formatYmLongLabel(ym);
  const nextYm = shiftYm(ym, 1);
  const spendingChange = pctChange(recap.spendingCents, recap.previousSpendingCents);
  const running = ym === currentYm;

  return (
    <>
      <AppNav displayName={user.displayName} countryCode={user.countryCode} />
      <main
        className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}
      >
        <div>
          <Link href="/reports" className="text-sm text-sky-300 hover:text-sky-200">
            Reports
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{label} review</h1>
          <p className="mt-1 text-sm text-slate-400">
            {running ? "This month is still running; the totals are to today." : "How the month went, and what to tidy before closing it."}
          </p>
          {scoreNow ? (
            <p className="mt-1 text-sm text-slate-300" data-testid="month-score">
              <Link href="/insights" className="hover:text-slate-100">
                Financial score {scoreNow.score}
                {scoreBefore && scoreBefore.score !== scoreNow.score
                  ? `, ${scoreNow.score > scoreBefore.score ? "up" : "down"} ${Math.abs(scoreNow.score - scoreBefore.score)} on ${formatYmLongLabel(shiftYm(ym, -1))}`
                  : ""}
              </Link>
            </p>
          ) : null}
        </div>

        <nav aria-label="Month" className="flex flex-wrap items-center gap-2">
          <Link href={`/reports/month?month=${shiftYm(ym, -1)}`} className={navButton}>
            ← {formatYmLongLabel(shiftYm(ym, -1))}
          </Link>
          {nextYm <= currentYm ? (
            <Link href={`/reports/month?month=${nextYm}`} className={navButton}>
              {formatYmLongLabel(nextYm)} →
            </Link>
          ) : null}
        </nav>

        <section aria-label="Month totals" data-testid="month-totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {[
            { label: "Income", value: fmt(recap.incomeCents) },
            { label: "Spending", value: fmt(recap.spendingCents) },
            { label: recap.netCents >= 0 ? "Left over" : "Overspent", value: fmt(Math.abs(recap.netCents)) },
            { label: "Entries", value: String(recap.transactionCount) },
          ].map((tile) => (
            <div key={tile.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="text-xs text-slate-400 sm:text-sm">{tile.label}</p>
              <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-xl">{tile.value}</p>
            </div>
          ))}
        </section>

        <section aria-labelledby="month-changed" className={card}>
          <h2 id="month-changed" className="text-lg font-semibold">
            What changed
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {spendingChange ? (
              <li>
                You spent {spendingChange} in {formatYmLongLabel(shiftYm(ym, -1))}.
              </li>
            ) : null}
            {recap.changes.map((c) => (
              <li key={c.categoryName}>
                {c.categoryName}: {fmt(c.cents)}, {c.cents > c.previousCents ? "up" : "down"} from {fmt(c.previousCents)}.
              </li>
            ))}
            {!spendingChange && recap.changes.length === 0 ? <li>Nothing moved much against the month before.</li> : null}
          </ul>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-slate-400">Where it went</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {recap.categories.map((c) => (
                  <li key={c.categoryName} className="flex justify-between gap-2">
                    <span className="truncate">{c.categoryName}</span>
                    <span className="tabular-nums">{fmt(c.cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-400">Biggest purchases</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {recap.biggest.map((b, i) => (
                  <li key={`${b.dateYmd}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">
                      {formatDateOnlyUtc(dateFromYmd(b.dateYmd))} · {b.title}
                    </span>
                    <span className="tabular-nums">{fmt(b.cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="month-budgets" data-testid="month-budgets" className={card}>
          <h2 id="month-budgets" className="text-lg font-semibold">
            Budgets
          </h2>
          {recap.budgetsKept.length + recap.budgetsMissed.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No budgets were set for {label}.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-400">
                Kept {recap.budgetsKept.length} of {recap.budgetsKept.length + recap.budgetsMissed.length}.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {[...recap.budgetsMissed, ...recap.budgetsKept].map((b) => {
                  const left = b.limitCents - b.spentCents;
                  const rolls = rolloverByName.get(b.categoryName);
                  return (
                    <li key={b.categoryName} className="flex flex-wrap justify-between gap-x-2">
                      <span>
                        {b.categoryName}{" "}
                        <span className={left < 0 ? "text-red-300" : "text-emerald-300"}>
                          {left < 0 ? `over by ${fmt(-left)}` : `${fmt(left)} left`}
                        </span>
                      </span>
                      <span className="text-slate-400">
                        {rolls ? `${left < 0 ? "comes off" : "rolls into"} ${formatYmLongLabel(nextYm)}` : "no rollover"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Rollover is set per category in{" "}
                <Link href="/settings/categories" className="text-sky-300 hover:text-sky-200">
                  Settings → Categories
                </Link>
                .
              </p>
            </>
          )}
        </section>

        <section aria-labelledby="month-close-heading" className={card}>
          <h2 id="month-close-heading" className="text-lg font-semibold">
            Close the month
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-300" data-testid="month-unreviewed">
            <li>
              {needsReview === 0
                ? "No bank transactions are waiting for review."
                : `${needsReview} bank transaction${needsReview === 1 ? " is" : "s are"} waiting for review in the Expense Log.`}
              {needsReview > 0 ? (
                <>
                  {" "}
                  <Link href={`/?month=${ym}`} className="text-sky-300 hover:text-sky-200">
                    Review them
                  </Link>
                </>
              ) : null}
            </li>
            <li>
              {unreviewedPosted === 0
                ? "Every imported or automatically posted entry has been looked at."
                : `${unreviewedPosted} imported or automatically posted entr${unreviewedPosted === 1 ? "y needs" : "ies need"} a look (Needs review in the Expense Log).`}
              {unreviewedPosted > 0 ? (
                <>
                  {" "}
                  <Link href={`/?month=${ym}`} className="text-sky-300 hover:text-sky-200">
                    Open the log
                  </Link>
                </>
              ) : null}
            </li>
          </ul>
          <div className="mt-3">
            <MonthCloseButton ym={ym} closedDisplay={closed ? formatDateOnlyUtc(closed.closedAt) : null} />
          </div>
        </section>
      </main>
    </>
  );
}
