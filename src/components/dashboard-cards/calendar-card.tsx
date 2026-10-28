import Link from "next/link";
import { formatCurrency } from "@/lib/money";
import { dayLogHref, type CalendarMonth } from "@/lib/spending-calendar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Whole dollars, so an amount fits in a day cell on a phone. */
function short(cents: number): string {
  return formatCurrency(Math.round(cents / 100) * 100).replace(/\.00$/, "");
}

export type CalendarCardBodyProps = {
  month: CalendarMonth | null;
  showBills?: boolean;
};

export function CalendarCardBody({ month, showBills = true }: CalendarCardBodyProps) {
  if (!month) {
    return <p className="text-sm text-slate-400">Choose a single month in the period filter to see it as a calendar.</p>;
  }
  return (
    <div data-testid="spending-calendar">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          Spent <span className="font-semibold text-slate-100">{formatCurrency(month.spentCents)}</span>
        </span>
        <span>
          Received <span className="font-semibold text-emerald-200">{formatCurrency(month.incomeCents)}</span>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Spending by day">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="text-[10px] uppercase tracking-wide text-slate-500">
            {d}
          </div>
        ))}
        {month.weeks.flat().map((day) =>
          day.inMonth ? (
            <Link
              key={day.dateYmd}
              href={dayLogHref(day.dateYmd)}
              role="gridcell"
              data-calendar-day={day.dateYmd}
              aria-label={`${day.dateYmd}: spent ${formatCurrency(day.spentCents)}${
                day.bills.length ? `, ${day.bills.length} recurring or planned due` : ""
              }`}
              className={`flex min-h-14 min-w-0 flex-col items-stretch rounded-lg border p-1 text-left transition hover:border-sky-500/60 hover:bg-slate-800 ${
                day.isToday ? "border-sky-500/70 bg-sky-950/30" : "border-slate-800 bg-slate-950/50"
              } ${month.busiestYmd === day.dateYmd ? "ring-1 ring-amber-400/50" : ""}`}
            >
              <span className={`text-[11px] ${day.isToday ? "font-semibold text-sky-200" : "text-slate-400"}`}>{day.day}</span>
              {day.spentCents !== 0 ? (
                <span className="truncate text-[11px] font-medium tabular-nums text-slate-100">{short(day.spentCents)}</span>
              ) : null}
              {day.incomeCents > 0 ? (
                <span className="truncate text-[10px] tabular-nums text-emerald-300">+{short(day.incomeCents)}</span>
              ) : null}
              {showBills && day.bills.length > 0 ? (
                <span className="mt-auto flex flex-wrap gap-0.5" aria-hidden>
                  {day.bills.slice(0, 4).map((b, i) => (
                    <span
                      key={i}
                      title={`${b.planned ? "Planned: " : ""}${b.name}: ${formatCurrency(b.cents)}`}
                      data-planned={b.planned ? "" : undefined}
                      className={`h-1.5 w-1.5 rounded-full ${
                        b.type === "INCOME" ? "bg-emerald-400" : b.overdue ? "bg-red-400" : "bg-amber-300"
                      } ${b.planned ? "ring-1 ring-sky-300 ring-offset-1 ring-offset-slate-950" : ""}`}
                    />
                  ))}
                </span>
              ) : null}
            </Link>
          ) : (
            <div key={day.dateYmd} aria-hidden className="min-h-14" />
          ),
        )}
      </div>
      {showBills ? (
        <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
          <span>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
            bill due
          </span>
          <span>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            pay due
          </span>
          <span>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
            unposted
          </span>
          <span>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-slate-500 ring-1 ring-sky-300 ring-offset-1 ring-offset-slate-950" />
            planned
          </span>
          <span>Tap a day to see its entries.</span>
        </p>
      ) : null}
    </div>
  );
}
