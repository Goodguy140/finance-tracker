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
  /** Running total through this bucket; null once past the last bucket that has happened. */
  cumulativeCents: number | null;
  /** Running total the period was expected to reach by this bucket; null when nothing predicts it. */
  expectedCents: number | null;
};

/** Where the expected line came from, so the card can say so. */
export type ExpectedSpendBasis = "budgets" | "average";

export type MonthlyExpected = {
  /** Expected spend for one whole month. */
  cents: number;
  basis: ExpectedSpendBasis;
} | null;

type SpendRow = { date: Date; amountCents: number };

type SeriesOptions = {
  range: DashboardRange;
  /** Viewed month, or the through-month for YTD. */
  ym: string;
  /** Today in the user's timezone (`YYYY-MM-DD`); ends the actual-spend run. */
  todayYmd: string;
  /** Expected spend for one month, spread evenly across the buckets; omitted for no baseline. */
  monthlyExpected?: MonthlyExpected;
};

/**
 * What one month of spending is expected to come to.
 *
 * Budgets win when they exist — they are a deliberate statement of intent, where the
 * trailing average only restates habit. Months with no spend at all still count toward
 * that average: a quiet month is information, and dropping it would bias the baseline
 * upward. A user with neither budgets nor history gets no baseline rather than a zero
 * one, so the chart omits the comparison instead of implying a target of nothing.
 */
export function resolveMonthlyExpected(
  budgetedMonthlyCents: number,
  recentMonthlySpendCents: readonly number[],
): MonthlyExpected {
  if (budgetedMonthlyCents > 0) return { cents: budgetedMonthlyCents, basis: "budgets" };
  if (recentMonthlySpendCents.length === 0) return null;
  const sum = recentMonthlySpendCents.reduce((total, cents) => total + cents, 0);
  if (sum <= 0) return null;
  return { cents: Math.round(sum / recentMonthlySpendCents.length), basis: "average" };
}

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
  { range, ym, todayYmd, monthlyExpected = null }: SeriesOptions,
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

  // Index of the last bucket the actual-spend line runs to. Buckets past it are still
  // plotted — the axis covers the whole month so the baseline's final value is on screen —
  // but they carry a null total rather than flat-lining the actual line into days that
  // have not happened.
  let actualThroughIndex: number;

  if (range === "month") {
    const monthDays = daysInMonthYm(ym);
    const throughDay = ymOf(todayYmd) === ym ? Math.min(Number(todayYmd.slice(8, 10)), monthDays) : monthDays;
    // A future-dated expense still has to appear, or the curve would end below the total
    // the rest of the dashboard reports for the same period.
    const lastSpendDay = Math.max(0, ...Array.from(buckets.keys(), Number));
    actualThroughIndex = Math.min(monthDays, Math.max(throughDay, lastSpendDay)) - 1;
    const monthLabel = formatYmShortLabel(ym, false);
    for (let day = 1; day <= monthDays; day += 1) {
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
    // YTD and lifetime already end on a bucket that has happened.
    actualThroughIndex = keys.length - 1;
  }

  // The baseline accrues evenly: one month's expected spend prorated across that month's
  // days, or one whole month per bucket once the buckets are months.
  const monthDaysForExpected = range === "month" ? daysInMonthYm(ym) : 0;
  const expectedAt = (index: number): number | null => {
    if (!monthlyExpected) return null;
    if (range === "month") return Math.round((monthlyExpected.cents * (index + 1)) / monthDaysForExpected);
    return monthlyExpected.cents * (index + 1);
  };

  let running = 0;
  return keys.map((key, index) => {
    const bucketCents = buckets.get(key) ?? 0;
    running += bucketCents;
    return {
      label: labels[index],
      fullLabel: fullLabels[index],
      bucketCents,
      cumulativeCents: index <= actualThroughIndex ? running : null,
      expectedCents: expectedAt(index),
    };
  });
}

/**
 * The figures the card heading quotes: spend so far, and the baseline at that same point.
 *
 * Both come from the last bucket that has actually happened, not the last on the axis —
 * a month view now plots every day, so the final bucket's baseline is a whole month's
 * expectation and comparing today's spend against it would read as wildly under budget.
 */
export function summarizeCumulativeSpend(points: readonly CumulativeSpendPoint[]): {
  totalCents: number;
  expectedCents: number | null;
  gapCents: number | null;
} {
  let last: CumulativeSpendPoint | null = null;
  for (const point of points) {
    if (point.cumulativeCents !== null) last = point;
  }
  const totalCents = last?.cumulativeCents ?? 0;
  const expectedCents = last?.expectedCents ?? null;
  return {
    totalCents,
    expectedCents,
    gapCents: expectedCents === null ? null : totalCents - expectedCents,
  };
}
