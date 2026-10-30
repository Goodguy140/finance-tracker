import { PlannedPastDuePrompt, type PlannedItem } from "@/components/planned-transactions";
import { formatCurrency } from "@/lib/money";

export type BillsForecastItem = {
  key: string;
  name: string;
  /**
   * A transfer between the user's own accounts, a card payment among them, is listed on its day
   * but left out of the totals and the running net: no money comes in or goes out.
   */
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  /** Null for a card payment with neither a balance nor a minimum on record. */
  amountCents: number | null;
  categoryLabel: string;
  overdue: boolean;
  /** Set when the rule is carried past a missed occurrence from an earlier month. */
  missedSinceDisplay: string | null;
  /** A one-off plan rather than a recurring rule's occurrence. */
  planned: boolean;
  /** A credit card's payment due date, from the card's due day in Settings → Accounts. */
  cardPayment?: boolean;
  /** A subscription's "Decide by" date (a trial turning paid, a plan renewing), on its first listed charge. */
  decideByDisplay?: string | null;
};

export type BillsForecastDay = {
  dateYmd: string;
  /** "Today", "Tomorrow", or the date itself. */
  label: string;
  items: BillsForecastItem[];
  /** Expected income less bills from the start of the list through this day. */
  runningNetCents: number;
};

export type BillsForecastCardBodyProps = {
  days: BillsForecastDay[];
  windowDays: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Enabled recurring rules, open plans and card payments due; zero means there is nothing to forecast from. */
  ruleCount: number;
  /** Plans whose date has passed with nothing matching them in the log. */
  pastDuePlans: PlannedItem[];
};

function signed(cents: number): string {
  return `${cents < 0 ? "-" : "+"}${formatCurrency(Math.abs(cents))}`;
}

export function BillsForecastCardBody({
  days,
  windowDays,
  incomeCents,
  expenseCents,
  netCents,
  ruleCount,
  pastDuePlans,
}: BillsForecastCardBodyProps) {
  const listsMoves = days.some((day) => day.items.some((item) => item.type === "TRANSFER"));
  if (ruleCount === 0) {
    return (
      <p className="text-sm text-slate-400">
        Add a recurring bill or paycheque in the Recurring card, or plan a one-off on the Add card&apos;s Plan tab, and it
        will show up here.
      </p>
    );
  }

  return (
    <>
      <PlannedPastDuePrompt plans={pastDuePlans} />
      <div className="mb-3 grid grid-cols-1 gap-2 @md:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Income due</p>
          <p className="truncate text-sm font-semibold text-emerald-200">{formatCurrency(incomeCents)}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Bills due</p>
          <p className="truncate text-sm font-semibold text-blue-100">{formatCurrency(expenseCents)}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Net</p>
          <p className={`truncate text-sm font-semibold ${netCents >= 0 ? "text-emerald-200" : "text-red-200"}`}>
            {formatCurrency(netCents)}
          </p>
        </div>
      </div>
      {days.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing recurring or planned is due in the next {windowDays} days.</p>
      ) : (
        <ol className="max-h-[min(44vh,22rem)] space-y-3 overflow-y-auto pr-1" data-bills-forecast>
          {days.map((day) => (
            <li key={day.dateYmd} data-forecast-day={day.dateYmd}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{day.label}</h3>
                <span
                  className="text-[11px] tabular-nums text-slate-500"
                  title="Expected income less bills from the top of this list through this day"
                >
                  Running net {signed(day.runningNetCents)}
                </span>
              </div>
              <ul className="space-y-1.5">
                {day.items.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-2.5 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-100">{item.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        <span className="truncate">{item.categoryLabel}</span>
                        {item.cardPayment ? (
                          <span className="rounded-full border border-violet-500/45 bg-violet-500/15 px-1.5 py-px text-[11px] font-medium text-violet-100">
                            Card payment
                          </span>
                        ) : item.type === "TRANSFER" ? (
                          <span className="rounded-full border border-slate-500/45 bg-slate-500/15 px-1.5 py-px text-[11px] font-medium text-slate-200">
                            Transfer
                          </span>
                        ) : null}
                        {item.decideByDisplay ? (
                          <span className="rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-px text-[11px] font-medium text-amber-100">
                            Decide by {item.decideByDisplay}
                          </span>
                        ) : null}
                        {item.planned ? (
                          <span className="rounded-full border border-sky-500/45 bg-sky-500/15 px-1.5 py-px text-[11px] font-medium text-sky-100">
                            Planned
                          </span>
                        ) : null}
                        {item.overdue ? (
                          <span className="rounded-full border border-red-500/45 bg-red-500/15 px-1.5 py-px text-[11px] font-medium text-red-100">
                            Overdue
                          </span>
                        ) : null}
                        {item.missedSinceDisplay ? (
                          <span className="text-[11px] text-slate-500">Unposted since {item.missedSinceDisplay}</span>
                        ) : null}
                      </span>
                    </div>
                    {item.type === "TRANSFER" ? (
                      <span className="shrink-0 tabular-nums font-semibold text-slate-300">
                        {item.amountCents === null ? "Due" : formatCurrency(item.amountCents)}
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 tabular-nums font-semibold ${
                          item.type === "INCOME" ? "text-emerald-200" : "text-blue-100"
                        }`}
                      >
                        {item.type === "INCOME" ? "+" : "-"}
                        {formatCurrency(item.amountCents ?? 0)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {listsMoves ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Transfers and card payments move money between your own accounts, so they are listed but left out of the
          totals and the running net.
        </p>
      ) : null}
    </>
  );
}
