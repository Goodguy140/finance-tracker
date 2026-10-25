import { formatCurrency } from "@/lib/money";
import type { SafeToSpend } from "@/lib/safe-to-spend";

export type SafeToSpendCardBodyProps = {
  data: SafeToSpend | null;
  currency: string;
  showBreakdown?: boolean;
};

export function SafeToSpendCardBody({ data, currency, showBreakdown = true }: SafeToSpendCardBodyProps) {
  if (!data) return <p className="text-sm text-slate-400">Safe to spend could not be worked out right now.</p>;
  const money = (cents: number) => formatCurrency(cents, currency);
  const rows: Array<{ label: string; cents: number; sign: "+" | "-" }> = [
    { label: "Income received", cents: data.incomeReceivedCents, sign: "+" },
    { label: "Spent so far", cents: data.spentCents, sign: "-" },
    { label: "Income still expected", cents: data.expectedIncomeCents, sign: "+" },
    { label: "Bills still due", cents: data.billsDueCents, sign: "-" },
    { label: "Left in budgets", cents: data.budgetLeftCents, sign: "-" },
    { label: "Savings goals this month", cents: data.goalsCents, sign: "-" },
  ];
  const negative = data.safeCents < 0;
  return (
    <div data-testid="safe-to-spend">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">Free to spend until month end</p>
      <p
        data-testid="safe-to-spend-amount"
        className={`text-3xl font-semibold tabular-nums ${negative ? "text-red-200" : "text-emerald-200"}`}
      >
        {money(data.safeCents)}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {negative
          ? `Over-committed by ${money(-data.safeCents)} for the rest of the month.`
          : `About ${money(data.perDayCents)} a day for ${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"}.`}
      </p>
      {showBreakdown ? (
        <dl className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-2">
              <dt className="text-slate-400">{row.label}</dt>
              <dd className={`tabular-nums ${row.sign === "+" ? "text-emerald-200" : "text-slate-200"}`}>
                {row.sign === "+" ? "+" : "−"}
                {money(row.cents)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
