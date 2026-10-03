import { formatCurrency } from "@/lib/money";

export type BillsForecastItem = {
  key: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  amountCents: number;
  categoryLabel: string;
  overdue: boolean;
  /** Set when the rule is carried past a missed occurrence from an earlier month. */
  missedSinceDisplay: string | null;
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
  /** Enabled recurring rules; zero means there is nothing to forecast from. */
  ruleCount: number;
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
}: BillsForecastCardBodyProps) {
  if (ruleCount === 0) {
    return (
      <p className="text-sm text-slate-400">
        Add a recurring bill or paycheque in the Recurring card and it will show up here.
      </p>
    );
  }

  return (
    <>
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
        <p className="text-sm text-slate-400">Nothing recurring is due in the next {windowDays} days.</p>
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
                    <span
                      className={`shrink-0 tabular-nums font-semibold ${
                        item.type === "INCOME" ? "text-emerald-200" : "text-blue-100"
                      }`}
                    >
                      {item.type === "INCOME" ? "+" : "-"}
                      {formatCurrency(item.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
