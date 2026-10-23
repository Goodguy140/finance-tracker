import Link from "next/link";
import { deleteReconciliationAction, saveReconciliationAction } from "@/app/actions";
import { inputClass, primaryBtnClass, selectClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { SettingsCard, SettingsPage } from "@/components/settings/ui";
import { shiftYm } from "@/lib/dashboard-period";
import { formatDateOnlyUtc, ymdFromDateUtc } from "@/lib/date-only";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { loadReconcileInputs, parseBalanceInput, reconcile } from "@/lib/reconciliation";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function dayAfter(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return ymdFromDateUtc(d);
}

function lastDayOfMonth(ym: string): string {
  const d = new Date(`${shiftYm(ym, 1)}-01T00:00:00Z`);
  d.setUTCDate(0);
  return ymdFromDateUtc(d);
}

export default async function ReconcilePage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireLoadedUser();
  const sp = await searchParams;
  const accounts = await prisma.account.findMany({
    where: { userId: user.id, archived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true, currency: true },
  });
  const account = accounts.find((a) => a.id === one(sp.account)) ?? accounts[0];
  if (!account) {
    return (
      <SettingsPage section="accounts">
        <p className="text-sm text-slate-400">Add an account first.</p>
      </SettingsPage>
    );
  }

  const history = await prisma.accountReconciliation.findMany({
    where: { userId: user.id, accountId: account.id },
    orderBy: { endDate: "desc" },
  });
  const last = history[0];
  // Picks up where the last statement ended; otherwise last month.
  const lastMonth = shiftYm(currentYmdInTimeZone(user.timezone).slice(0, 7), -1);
  const from = YMD.test(one(sp.from)) ? one(sp.from) : last ? dayAfter(last.endDate) : `${lastMonth}-01`;
  const to = YMD.test(one(sp.to)) ? one(sp.to) : lastDayOfMonth(from.slice(0, 7));
  const openingRaw = one(sp.opening) || (last ? (last.closingCents / 100).toFixed(2) : "");
  const closingRaw = one(sp.closing);
  const opening = parseBalanceInput(openingRaw);
  const closing = parseBalanceInput(closingRaw);
  const money = (cents: number) => formatCurrency(cents, account.currency);

  const inputs = from <= to ? await loadReconcileInputs(prisma, user.id, account, from, to) : null;
  const result =
    inputs && opening !== null && closing !== null
      ? reconcile({ accountId: account.id, liability: inputs.liability, openingCents: opening, closingCents: closing, transactions: inputs.transactions })
      : null;

  return (
    <SettingsPage
      section="accounts"
      actions={
        <Link
          href="/settings/accounts"
          className="inline-flex items-center rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          Back to accounts
        </Link>
      }
    >
      <SettingsCard
        title="Reconcile with a statement"
        description={
          inputs?.liability
            ? "Enter what your statement says was owed at the start and end. The log's entries for those dates should take one to the other."
            : "Enter the balances your statement shows at the start and end. The log's entries for those dates should take one to the other."
        }
      >
        <form method="get" className="grid gap-2 sm:grid-cols-2" data-testid="reconcile-form">
          <label className="block sm:col-span-2">
            <span className="text-xs text-slate-400">Account</span>
            <select name="account" defaultValue={account.id} className={selectClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Statement from</span>
            <input type="date" name="from" defaultValue={from} className={inputClass} required />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">to</span>
            <input type="date" name="to" defaultValue={to} className={inputClass} required />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">{inputs?.liability ? "Owed at the start" : "Opening balance"}</span>
            <input name="opening" inputMode="decimal" defaultValue={openingRaw} className={inputClass} placeholder="0.00" required />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">{inputs?.liability ? "Owed at the end" : "Closing balance"}</span>
            <input name="closing" inputMode="decimal" defaultValue={closingRaw} className={inputClass} placeholder="0.00" required />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className={primaryBtnClass}>
              Check
            </button>
          </div>
        </form>

        {from > to ? <p className="text-sm text-amber-200">The statement has to end after it starts.</p> : null}
        {(openingRaw && opening === null) || (closingRaw && closing === null) ? (
          <p className="text-sm text-amber-200">Enter balances as plain amounts, like 1234.56.</p>
        ) : null}

        {result && inputs ? (
          <div className="space-y-3" data-testid="reconcile-result">
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-400">Money in</dt>
                <dd className="text-emerald-300">{money(result.moneyInCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Money out</dt>
                <dd className="text-slate-100">{money(result.moneyOutCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">The log arrives at</dt>
                <dd className="text-slate-100">{money(result.expectedClosingCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Statement says</dt>
                <dd className="text-slate-100">{money(closing!)}</dd>
              </div>
            </dl>
            {result.differenceCents === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
                <p role="status" className="text-sm text-emerald-200">
                  It matches. Every entry for these dates agrees with the statement.
                </p>
                <ServerActionForm action={saveReconciliationAction}>
                  <input type="hidden" name="accountId" value={account.id} />
                  <input type="hidden" name="from" value={from} />
                  <input type="hidden" name="to" value={to} />
                  <input type="hidden" name="opening" value={openingRaw} />
                  <input type="hidden" name="closing" value={closingRaw} />
                  <button type="submit" className={primaryBtnClass}>
                    Mark reconciled
                  </button>
                </ServerActionForm>
              </div>
            ) : (
              <div role="status" className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
                <p data-testid="reconcile-difference">
                  Off by {money(Math.abs(result.differenceCents))}: the statement shows{" "}
                  {(result.differenceCents > 0) !== inputs.liability ? "more" : "less"} money in the account than the log does.
                </p>
                <p className="text-xs text-amber-200/80">
                  Look for an entry that is missing, logged twice, on another account, or dated outside these days.
                  {inputs.waitingInQueue > 0
                    ? ` ${inputs.waitingInQueue} bank ${inputs.waitingInQueue === 1 ? "transaction" : "transactions"} for this account and these dates ${inputs.waitingInQueue === 1 ? "is" : "are"} still waiting in your review queue.`
                    : ""}
                </p>
              </div>
            )}
            {result.rows.length > 0 ? (
              <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-800">
                <table className="min-w-full text-left text-xs text-slate-300">
                  <thead className="sticky top-0 bg-slate-900 text-slate-200">
                    <tr>
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Entry</th>
                      <th className="px-2 py-1.5 text-right">In / out</th>
                      <th className="px-2 py-1.5 text-right">{inputs.liability ? "Owed" : "Balance"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-800">
                        <td className="whitespace-nowrap px-2 py-1.5">{formatDateOnlyUtc(row.date)}</td>
                        <td className="px-2 py-1.5">{row.title}</td>
                        <td className={`px-2 py-1.5 text-right ${row.inCents >= 0 ? "text-emerald-300" : ""}`}>
                          {row.inCents >= 0 ? "+" : "−"}
                          {money(Math.abs(row.inCents))}
                        </td>
                        <td className="px-2 py-1.5 text-right">{money(row.balanceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Nothing is logged on this account for these dates.</p>
            )}
          </div>
        ) : null}
      </SettingsCard>

      {history.length > 0 ? (
        <SettingsCard title="Reconciled statements" description={`For ${account.name}, newest first.`}>
          <ul className="divide-y divide-slate-800 text-sm" data-testid="reconcile-history">
            {history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-slate-200">
                  {formatDateOnlyUtc(r.startDate)} to {formatDateOnlyUtc(r.endDate)}
                  <span className="text-slate-500">
                    {" "}
                    · {money(r.openingCents)} to {money(r.closingCents)}
                  </span>
                </span>
                <ServerActionForm action={deleteReconciliationAction}>
                  <input type="hidden" name="reconciliationId" value={r.id} />
                  <button type="submit" className="text-xs text-slate-400 hover:text-red-200">
                    Forget
                  </button>
                </ServerActionForm>
              </li>
            ))}
          </ul>
        </SettingsCard>
      ) : null}
    </SettingsPage>
  );
}
