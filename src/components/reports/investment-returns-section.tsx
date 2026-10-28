import Link from "next/link";
import { displayRate, type ReturnWindow, type ReturnWindows } from "@/lib/investment-returns";
import type { InvestmentReturns } from "@/lib/investment-returns-data";
import { formatCurrency } from "@/lib/money";

const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:p-5";

export function formatRate(window: ReturnWindow | null): string {
  if (!window) return "—";
  const shown = displayRate(window);
  if (!shown) return "—";
  const pct = (shown.rate * 100).toFixed(1).replace(/^-0\.0$/, "0.0");
  return `${shown.rate > 0 ? "+" : ""}${pct}%${shown.annualized ? " a year" : ""}`;
}

const WINDOWS: Array<{ key: keyof ReturnWindows; label: string }> = [
  { key: "thisYear", label: "This year" },
  { key: "twelveMonths", label: "12 months" },
  { key: "sinceStart", label: "Since first value" },
];

/**
 * How each investment account did: value now, what was put in, growth, and the money-weighted
 * return over three windows.
 */
export function InvestmentReturnsSection({ returns }: { returns: InvestmentReturns }) {
  if (returns.accounts.length === 0) return null;
  const rows = [
    ...returns.accounts.map((a) => ({ id: a.accountId, name: a.name, currency: a.currency, windows: a.windows, href: `/accounts/${a.accountId}` })),
    ...(returns.total?.sinceStart && returns.accounts.length > 1
      ? [{ id: "total", name: "All together", currency: returns.currency, windows: returns.total, href: null }]
      : []),
  ];
  return (
    <section aria-labelledby="report-returns" className={card} data-testid="report-investment-returns">
      <h2 id="report-returns" className="text-lg font-semibold">
        Investment returns
      </h2>
      <p className="mt-0.5 text-sm text-slate-400">
        Growth after what you put in and took out, and the money-weighted return: a year&apos;s rate from a year of history,
        the period&apos;s own rate below that. From your portfolio values and balances, contributions and withdrawals, and
        transfers in and out.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 pr-3 font-normal">Account</th>
              <th className="py-1 pr-3 text-right font-normal">Value</th>
              <th className="py-1 pr-3 text-right font-normal">Put in</th>
              <th className="py-1 pr-3 text-right font-normal">Growth</th>
              {WINDOWS.map((w) => (
                <th key={w.key} className="py-1 pr-3 text-right font-normal last:pr-0">
                  {w.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => {
              const since = row.windows.sinceStart!;
              const money = (cents: number) => formatCurrency(cents, row.currency);
              return (
                <tr key={row.id} data-testid="returns-row" className={row.href ? "" : "font-medium"}>
                  <td className="py-1.5 pr-3">
                    {row.href ? (
                      <Link href={row.href} className="text-slate-200 hover:text-sky-200 hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(since.endCents)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">{money(since.startCents + since.netContributedCents)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${since.growthCents >= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                    {money(since.growthCents)}
                  </td>
                  {WINDOWS.map((w) => (
                    <td key={w.key} className="py-1.5 pr-3 text-right tabular-nums text-slate-300 last:pr-0" data-testid={`returns-${w.key}`}>
                      {formatRate(row.windows[w.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
