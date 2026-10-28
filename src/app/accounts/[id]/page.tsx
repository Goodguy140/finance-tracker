import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountTypePill } from "@/components/account-type-pill";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { formatRate } from "@/components/reports/investment-returns-section";
import { AccountBalanceChart } from "@/components/reports/report-charts";
import { loadInvestmentReturns } from "@/lib/investment-returns-data";
import { loadAccountPage, REGISTER_MONTH_OPTIONS } from "@/lib/account-page-data";
import { cardUtilization, dueDayLabel, HIGH_UTILIZATION_PCT } from "@/lib/credit-cards";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { formatCurrency } from "@/lib/money";
import { CADENCE_LABELS, type Cadence } from "@/lib/printables/templates";
import { searchPageHref } from "@/lib/search/search-paths";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";
const linkBtn =
  "inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800";
const SOURCE_LABEL = { PLAID: "from your bank", MANUAL: "entered by you", PORTFOLIO: "portfolio snapshot" } as const;

/** One account: its balance over time, its register with a running balance, and what feeds it. */
export default async function AccountPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const monthsRaw = Number(Array.isArray(sp.months) ? sp.months[0] : sp.months);
  const months = (REGISTER_MONTH_OPTIONS as readonly number[]).includes(monthsRaw) ? monthsRaw : REGISTER_MONTH_OPTIONS[0];
  const [data, returns] = await Promise.all([loadAccountPage(user, id, months), loadInvestmentReturns(user)]);
  if (!data) notFound();

  const { account, liability, latest } = data;
  const fmt = (cents: number) => formatCurrency(cents, account.currency);
  const utilization = account.type === "CREDIT_CARD" ? cardUtilization(latest?.cents, account.creditLimitCents) : null;
  const own = returns.accounts.find((r) => r.accountId === account.id)?.windows ?? null;
  const signedIn = (cents: number) => (cents >= 0 ? `+${fmt(cents)}` : `−${fmt(-cents)}`);

  return (
    <>
      <AppNav displayName={user.displayName} countryCode={user.countryCode} />
      <main className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{account.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <AccountTypePill accountType={account.type} />
              <span>{account.currency}</span>
              {account.archived ? <span className="text-slate-500">Archived</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={searchPageHref({ accountId: account.id })} className={linkBtn}>
              All transactions
            </Link>
            <Link href={`/settings/accounts/reconcile?account=${account.id}`} className={linkBtn}>
              Reconcile
            </Link>
            <Link href="/settings/accounts" className={linkBtn}>
              Edit
            </Link>
          </div>
        </div>

        <section aria-labelledby="account-balance" className={card} data-testid="account-summary">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
              <p id="account-balance" className="text-xs text-slate-400">
                {liability ? "Owed now" : "Balance now"}
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums" data-testid="account-balance-now">
                {latest ? fmt(latest.cents) : "No balance yet"}
              </p>
              <p className="text-[11px] text-slate-500">
                {latest ? `${formatDateOnlyUtc(latest.date)}, ${SOURCE_LABEL[latest.source]}` : "Add one in Settings → Accounts"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
              <p className="text-xs text-slate-400">{liability ? "Payments and refunds this month" : "Money in this month"}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-300">{fmt(data.thisMonth.inCents)}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
              <p className="text-xs text-slate-400">{liability ? "Charges this month" : "Money out this month"}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{fmt(data.thisMonth.outCents)}</p>
            </div>
          </div>
          {account.type === "CREDIT_CARD" && (account.creditLimitCents !== null || account.paymentDueDay !== null) ? (
            <p className={`mt-3 text-sm ${utilization?.high ? "text-amber-200" : "text-slate-400"}`} data-testid="account-card-terms">
              {account.creditLimitCents !== null ? `Limit ${fmt(account.creditLimitCents)}` : null}
              {utilization ? `, ${utilization.pct}% used${utilization.high ? ` (over ${HIGH_UTILIZATION_PCT}%)` : ""}` : null}
              {account.creditLimitCents !== null && account.paymentDueDay !== null ? ". " : null}
              {account.paymentDueDay !== null ? `Payment due on ${dueDayLabel(account.paymentDueDay)} of each month.` : null}
            </p>
          ) : null}
          {own?.sinceStart ? (
            <p className="mt-3 text-sm text-slate-400" data-testid="account-returns">
              Growth {fmt(own.sinceStart.growthCents)} after {fmt(own.sinceStart.startCents + own.sinceStart.netContributedCents)} put in since{" "}
              {formatDateOnlyUtc(own.sinceStart.startDate)}. Return: this year {formatRate(own.thisYear)}, 12 months{" "}
              {formatRate(own.twelveMonths)}, since first value {formatRate(own.sinceStart)}.
            </p>
          ) : null}
          {data.history.length > 1 ? (
            <div className="mt-4">
              <AccountBalanceChart data={data.history} currency={account.currency} owed={liability} />
            </div>
          ) : null}
        </section>

        {data.bank || data.waitingInQueue > 0 ? (
          <section aria-labelledby="account-bank" className={card}>
            <h2 id="account-bank" className="text-lg font-semibold">
              Bank
            </h2>
            {data.bank ? (
              <p className="mt-1 text-sm text-slate-300">
                Linked to {data.bank.institutionName}.{" "}
                {data.bank.lastSyncedAt ? `Last synced ${data.bank.lastSyncedAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}.` : "Not synced yet."}
              </p>
            ) : null}
            {data.bank?.attention ? <p className="mt-1 text-sm text-amber-200">{data.bank.attention.message}</p> : null}
            {data.bank?.lastSyncError && !data.bank.attention ? (
              <p className="mt-1 text-sm text-amber-200">The last sync failed: {data.bank.lastSyncError}</p>
            ) : null}
            {data.waitingInQueue > 0 ? (
              <p className="mt-1 text-sm text-slate-300">
                {data.waitingInQueue} bank row{data.waitingInQueue === 1 ? "" : "s"} waiting for review.{" "}
                <Link href="/" className="text-sky-300 hover:text-sky-200">
                  Review on the dashboard
                </Link>
              </p>
            ) : null}
            <Link href="/settings/banks" className="mt-2 inline-block text-sm text-sky-300 hover:text-sky-200">
              Bank connections
            </Link>
          </section>
        ) : null}

        <section aria-labelledby="account-register" className={card} data-testid="account-register">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="account-register" className="text-lg font-semibold">
              Register
            </h2>
            <span className="flex gap-3 text-sm">
              {REGISTER_MONTH_OPTIONS.map((n) => (
                <Link
                  key={n}
                  href={`/accounts/${account.id}?months=${n}`}
                  aria-current={n === data.registerMonths ? "true" : undefined}
                  className={n === data.registerMonths ? "font-medium text-slate-100" : "text-sky-300 hover:text-sky-200"}
                >
                  {n} months
                </Link>
              ))}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-400">
            {latest
              ? `Running ${liability ? "amount owed" : "balance"}, worked back from the ${formatDateOnlyUtc(latest.date)} balance. Entries after it are marked: no balance has confirmed them yet.`
              : "Add a balance to see the running balance next to each entry."}
          </p>
          {data.register.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing on this account in the last {data.registerMonths} months.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.register.map((row) => (
                  <tr key={row.id} data-testid="register-row">
                    <td className="whitespace-nowrap py-1.5 pr-3 align-top text-xs text-slate-500">{formatDateOnlyUtc(row.date)}</td>
                    <td className="w-full max-w-0 py-1.5 pr-3 align-top">
                      <span className="block truncate text-slate-200">{row.title}</span>
                      {row.type === "TRANSFER" ? <span className="text-[11px] text-slate-500">Transfer</span> : null}
                    </td>
                    <td className={`whitespace-nowrap py-1.5 pr-3 text-right align-top tabular-nums ${row.inCents >= 0 ? "text-emerald-300" : "text-slate-200"}`}>
                      {signedIn(row.inCents)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right align-top tabular-nums text-slate-400" data-testid="register-balance">
                      {row.balanceCents === null ? "" : fmt(row.balanceCents)}
                      {row.afterReading ? <span title="After the latest balance"> *</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {data.rules.length > 0 ? (
          <section aria-labelledby="account-recurring" className={card}>
            <h2 id="account-recurring" className="text-lg font-semibold">
              Recurring
            </h2>
            <ul className="mt-2 divide-y divide-slate-800 text-sm">
              {data.rules.map((rule) => (
                <li key={rule.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">{rule.name}</span>
                    <span className="text-xs text-slate-500">
                      {CADENCE_LABELS[rule.cadence as Cadence] ?? rule.cadence}
                      {rule.transfer ? ` · transfer ${rule.transfer.into ? "from" : "to"} ${rule.transfer.otherName}` : rule.type === "INCOME" ? " · income" : ""}
                      {` · next ${formatDateOnlyUtc(rule.nextExpectedDate)}`}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-300">{fmt(rule.amountCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.goals.length > 0 ? (
          <section aria-labelledby="account-goals" className={card}>
            <h2 id="account-goals" className="text-lg font-semibold">
              Savings goals
            </h2>
            <ul className="mt-2 divide-y divide-slate-800 text-sm">
              {data.goals.map((goal) => (
                <li key={goal.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="truncate text-slate-200">{goal.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">
                    {Math.round(goal.progress.fraction * 100)}% of {formatCurrency(goal.targetCents, goal.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
