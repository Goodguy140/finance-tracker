import { formatCurrency } from "@/lib/money";
import type { ZeroBasedSummary } from "@/lib/zero-based";

export type ZeroBasedCardBodyProps = {
  data: ZeroBasedSummary | null;
  currency: string;
  showBreakdown?: boolean;
};

/** The Safe to spend card in zero-based mode: income still to give a job, and overspending to cover. */
export function ZeroBasedCardBody({ data, currency, showBreakdown = true }: ZeroBasedCardBodyProps) {
  if (!data) return <p className="text-sm text-slate-400">To assign could not be worked out right now.</p>;
  const money = (cents: number) => formatCurrency(cents, currency);
  const over = data.toAssignCents < 0;
  const rows: Array<{ label: string; cents: number; sign: "+" | "-" }> = [
    { label: "Income this month", cents: data.incomeCents, sign: "+" },
    { label: "Assigned to budgets", cents: data.assignedCents, sign: "-" },
    { label: "Bills outside budgets", cents: data.billsOutsideBudgetsCents, sign: "-" },
    { label: "Spent outside budgets", cents: data.spentOutsideBudgetsCents, sign: "-" },
    { label: "Savings goals this month", cents: data.goalsCents, sign: "-" },
  ];
  return (
    <div data-testid="zero-based">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">To assign this month</p>
      <p
        data-testid="zero-based-amount"
        className={`text-3xl font-semibold tabular-nums ${over ? "text-red-200" : data.toAssignCents === 0 ? "text-slate-100" : "text-emerald-200"}`}
      >
        {money(data.toAssignCents)}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {over
          ? `Assigned ${money(-data.toAssignCents)} more than this month's income. Lower a budget to balance.`
          : data.toAssignCents === 0
            ? "Every dollar has a job."
            : "Give this money a job: raise a budget or a savings goal."}
      </p>
      {data.overspent.length > 0 ? (
        <div data-testid="zero-based-overspent" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">
          <p className="text-red-100">
            {money(data.overspentCents)} overspent to cover. Move money in from another budget (Budgets card).
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-red-200/90">
            {data.overspent.slice(0, 4).map((o) => (
              <li key={o.categoryId} className="flex justify-between gap-2">
                <span className="truncate">{o.categoryName}</span>
                <span className="tabular-nums">{money(o.overCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
