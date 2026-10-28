import Link from "next/link";
import { setDebtTermsAction } from "@/app/actions";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { inputClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { getCountryConfig } from "@/lib/country-config";
import { cardUtilization } from "@/lib/credit-cards";
import { formatYmLongLabel, shiftYm } from "@/lib/dashboard-period";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { minimumsTotal, simulatePayoff, type Debt, type PayoffResult, type PayoffStrategy } from "@/lib/debt-payoff";
import { formatCurrency, parseCentsInput } from "@/lib/money";
import { isLiabilityType } from "@/lib/net-worth";
import { loadNetWorth } from "@/lib/net-worth-data";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";
const linkBtn =
  "inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STRATEGIES: Array<{ id: PayoffStrategy; label: string; hint: string }> = [
  { id: "avalanche", label: "Highest rate first", hint: "Avalanche: the least interest overall." },
  { id: "snowball", label: "Smallest balance first", hint: "Snowball: the first debt is gone soonest." },
  { id: "minimums", label: "Minimums only", hint: "Only what the lenders require, for comparison." },
];

/** Credit cards and loans: what they cost, and the quickest way out. */
export default async function DebtPayoffPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const currency = getCountryConfig(user.countryCode).defaultCurrency;
  const fmt = (cents: number) => formatCurrency(cents, currency);
  const [accounts, netWorth] = await Promise.all([
    prisma.account.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, interestRateBps: true, minimumPaymentCents: true },
    }),
    loadNetWorth(user),
  ]);
  const balances = new Map(netWorth.accounts.map((row) => [row.accountId, row]));
  const liabilities = accounts.filter((a) => isLiabilityType(a.type));

  const debts: Debt[] = [];
  const missing: string[] = [];
  for (const a of liabilities) {
    const row = balances.get(a.id);
    if (!row?.counted || !row.latest || row.latest.cents <= 0) continue;
    if (a.interestRateBps === null || a.minimumPaymentCents === null) missing.push(a.name);
    debts.push({
      id: a.id,
      name: a.name,
      balanceCents: row.latest.cents,
      aprBps: a.interestRateBps ?? 0,
      minimumCents: a.minimumPaymentCents ?? 0,
    });
  }

  const minimums = minimumsTotal(debts);
  const monthlyInput = parseCentsInput(one(sp.monthly));
  const monthly = Math.max(monthlyInput ?? minimums, minimums);
  const strategy = (STRATEGIES.find((s) => s.id === one(sp.strategy))?.id ?? "avalanche") as PayoffStrategy;
  const results = Object.fromEntries(
    STRATEGIES.map((s) => [s.id, simulatePayoff(debts, monthly, s.id)]),
  ) as Record<PayoffStrategy, PayoffResult>;
  const chosen = results[strategy];
  const thisYm = currentYmdInTimeZone(user.timezone).slice(0, 7);
  const monthLabel = (n: number) => formatYmLongLabel(shiftYm(thisYm, n));
  const totalOwed = debts.reduce((sum, d) => sum + d.balanceCents, 0);

  return (
    <>
      <AppNav displayName={user.displayName} countryCode={user.countryCode} />
      <main className={`mx-auto my-4 w-full max-w-4xl space-y-4 px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:space-y-5 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Debt payoff</h1>
            <p className="mt-1 text-sm text-slate-400">
              Your credit cards and loans, what they cost in interest, and a month-by-month way out.
            </p>
          </div>
          <Link href="/reports" className={linkBtn}>
            Back to reports
          </Link>
        </div>

        <section aria-labelledby="debt-list" className={card}>
          <h2 id="debt-list" className="text-lg font-semibold">
            What you owe
          </h2>
          {liabilities.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              No credit card or loan accounts yet. Add one in <Link href="/settings/accounts" className="text-sky-300">Settings → Accounts</Link>.
            </p>
          ) : (
            <ul className="mt-3 space-y-3" data-testid="debt-accounts">
              {liabilities.map((a) => {
                const row = balances.get(a.id);
                const owed = row?.counted && row.latest ? row.latest.cents : null;
                return (
                  <li key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-sm text-slate-300">
                        {owed === null ? (
                          <Link href="/settings/accounts" className="text-sky-300">
                            Add a balance
                          </Link>
                        ) : (
                          <>
                            {fmt(owed)} owed
                            <span className="text-xs text-slate-500"> · {formatDateOnlyUtc(row!.latest!.date)}</span>
                            {(() => {
                              const u = cardUtilization(owed, row!.creditLimitCents);
                              return u ? (
                                <span className={`text-xs ${u.high ? "text-amber-200" : "text-slate-500"}`}> · {u.pct}% of limit</span>
                              ) : null;
                            })()}
                          </>
                        )}
                      </span>
                    </div>
                    <ServerActionForm action={setDebtTermsAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="accountId" value={a.id} />
                      <label className="block w-32">
                        <span className="text-xs text-slate-400">Interest rate %</span>
                        <input
                          name="apr"
                          inputMode="decimal"
                          defaultValue={a.interestRateBps === null ? "" : (a.interestRateBps / 100).toFixed(2)}
                          placeholder="19.99"
                          aria-label={`Interest rate for ${a.name}`}
                          className={inputClass}
                        />
                      </label>
                      <label className="block w-36">
                        <span className="text-xs text-slate-400">Minimum a month</span>
                        <input
                          name="minimum"
                          inputMode="decimal"
                          defaultValue={a.minimumPaymentCents === null ? "" : (a.minimumPaymentCents / 100).toFixed(2)}
                          placeholder="25.00"
                          aria-label={`Minimum payment for ${a.name}`}
                          className={inputClass}
                        />
                      </label>
                      <button type="submit" className={linkBtn} aria-label={`Save ${a.name}`}>
                        Save
                      </button>
                    </ServerActionForm>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {debts.length > 0 ? (
          <section aria-labelledby="debt-plan" className={card} data-testid="debt-plan">
            <h2 id="debt-plan" className="text-lg font-semibold">
              Your plan
            </h2>
            {missing.length > 0 ? (
              <p className="mt-1 text-xs text-amber-200">
                Add the rate and minimum for {missing.join(", ")} above; until then it counts as interest-free with no minimum.
              </p>
            ) : null}
            <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block w-44">
                <span className="text-xs text-slate-400">Paying each month</span>
                <input
                  name="monthly"
                  inputMode="decimal"
                  defaultValue={(monthly / 100).toFixed(2)}
                  aria-label="Paying each month"
                  className={inputClass}
                />
              </label>
              <input type="hidden" name="strategy" value={strategy} />
              <button type="submit" className={linkBtn}>
                Work it out
              </button>
              <span className="pb-2 text-xs text-slate-500">Minimums add up to {fmt(minimums)}.</span>
            </form>

            <div className="mt-4 grid gap-2 sm:grid-cols-3" role="list" aria-label="Ways to pay it off">
              {STRATEGIES.map((s) => {
                const r = results[s.id];
                const active = s.id === strategy;
                return (
                  <Link
                    key={s.id}
                    role="listitem"
                    href={`/reports/debt?strategy=${s.id}&monthly=${(monthly / 100).toFixed(2)}`}
                    aria-current={active ? "true" : undefined}
                    data-testid={`debt-strategy-${s.id}`}
                    className={`rounded-xl border p-3 transition ${active ? "border-sky-500/60 bg-sky-950/30" : "border-slate-800 bg-slate-950/40 hover:bg-slate-900"}`}
                  >
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="text-xs text-slate-500">{s.hint}</p>
                    <p className="mt-2 text-sm">
                      {r.months === null ? (
                        <span className="text-amber-200">Never paid off at this rate</span>
                      ) : (
                        <>
                          Debt-free by <span className="font-semibold">{monthLabel(r.months)}</span>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">Interest: {fmt(r.totalInterestCents)}</p>
                  </Link>
                );
              })}
            </div>

            {chosen.payoffOrder.length > 0 ? (
              <ol className="mt-4 space-y-1 text-sm" data-testid="debt-order">
                {chosen.payoffOrder.map((p, i) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {i + 1}. {p.name}
                    </span>
                    <span className="text-slate-400">paid off {monthLabel(p.month)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <p className="mt-3 text-xs text-slate-500">
              Starts from {fmt(totalOwed)} owed, with interest added monthly at each rate. Paying{" "}
              {fmt(monthly)} a month, compared with minimums only this saves{" "}
              {fmt(Math.max(0, results.minimums.totalInterestCents - chosen.totalInterestCents))} in interest
              {results.minimums.months === null ? " (minimums alone never clear it)" : ""}.
            </p>
          </section>
        ) : null}
      </main>
    </>
  );
}
