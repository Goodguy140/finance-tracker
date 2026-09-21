import {
  type DashboardRange,
  formatYmShortLabel,
  shiftYm,
} from "@/lib/dashboard-period";

/** One x-axis bucket of the cumulative spend curve. */
export type CumulativeSpendPoint = {
  /** Axis tick: day of month in a month view, short month otherwise. */
  label: string;
  /** Full description for the tooltip heading. */
  fullLabel: string;
  /** Spend falling in this bucket alone. */
  bucketCents: number;
  /** Running total from the first bucket of the period through this one. */
  cumulativeCents: number;
};

type SpendRow = { date: Date; amountCents: number };

type SeriesOptions = {
  range: DashboardRange;
  /** Viewed month, or the through-month for YTD. */
  ym: string;
  /** Today in the user's timezone (`YYYY-MM-DD`); trims buckets that have not happened yet. */
  todayYmd: string;
};

function ymOf(ymd: string): string {
  return ymd.slice(0, 7);
}

function daysInMonthYm(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Cumulative spend across the dashboard's selected period.
 *
 * Buckets are days for a single month and calendar months for YTD and lifetime. Buckets
 * with no spend are still emitted so the line is evenly spaced in time rather than jumping
 * between the days that happen to have transactions. Buckets after today are dropped: a
 * cumulative line that flat-lines across the rest of the month reads as "spending stopped"
 * rather than "the month is not over".
 *
 * Amounts come from `Transaction.amountCents`, which is the whole transaction — split parts
 * divide that same total between categories and would double-count if added on top.
 */
export function buildCumulativeSpendSeries(
  expenses: SpendRow[],
  { range, ym, todayYmd }: SeriesOptions,
): CumulativeSpendPoint[] {
  const buckets = new Map<string, number>();
  for (const row of expenses) {
    const key =
      range === "month"
        ? String(row.date.getUTCDate())
        : `${row.date.getUTCFullYear()}-${String(row.date.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + row.amountCents);
  }

  const keys: string[] = [];
  const labels: string[] = [];
  const fullLabels: string[] = [];

  if (range === "month") {
    const monthDays = daysInMonthYm(ym);
    const throughDay = ymOf(todayYmd) === ym ? Math.min(Number(todayYmd.slice(8, 10)), monthDays) : monthDays;
    // A future-dated expense still has to appear, or the curve would end below the total
    // the rest of the dashboard reports for the same period.
    const lastSpendDay = Math.max(0, ...Array.from(buckets.keys(), Number));
    const lastDay = Math.min(monthDays, Math.max(throughDay, lastSpendDay));
    const monthLabel = formatYmShortLabel(ym, false);
    for (let day = 1; day <= lastDay; day += 1) {
      keys.push(String(day));
      labels.push(String(day));
      fullLabels.push(`${monthLabel} ${day}`);
    }
  } else {
    // YTD runs Jan through the anchor month; lifetime spans the months that actually
    // have spend, so an empty log produces an empty chart rather than a bare axis.
    const present = Array.from(buckets.keys()).sort();
    const lastSpendYm = present[present.length - 1];
    let firstYm: string;
    let lastYm: string;
    if (range === "ytd") {
      firstYm = `${ym.slice(0, 4)}-01`;
      // Stop at today so the tail is not a flat line through months that have not
      // happened, but never before a month that already holds spend.
      const throughYm = ymOf(todayYmd) < ym ? ymOf(todayYmd) : ym;
      lastYm = lastSpendYm && lastSpendYm > throughYm ? lastSpendYm : throughYm;
      if (lastYm > ym) lastYm = ym;
    } else {
      if (present.length === 0) return [];
      firstYm = present[0];
      lastYm = lastSpendYm;
    }
    if (firstYm > lastYm) return [];

    const withYear = range === "lifetime" || firstYm.slice(0, 4) !== lastYm.slice(0, 4);
    for (let cursor = firstYm; cursor <= lastYm; cursor = shiftYm(cursor, 1)) {
      keys.push(cursor);
      labels.push(formatYmShortLabel(cursor, withYear));
      fullLabels.push(formatYmShortLabel(cursor, true));
    }
  }

  let running = 0;
  return keys.map((key, index) => {
    const bucketCents = buckets.get(key) ?? 0;
    running += bucketCents;
    return {
      label: labels[index],
      fullLabel: fullLabels[index],
      bucketCents,
      cumulativeCents: running,
    };
  });
}
