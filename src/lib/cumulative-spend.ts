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
  /** Earlier months' running total by the same day of month; null when no comparison is drawn. */
  comparisonCents: number | null;
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
  /** The days of a custom range. */
  custom?: { fromYmd: string; toYmd: string };
  /** Viewed month, or the through-month for YTD. */
  ym: string;
  /** Today in the user's timezone (`YYYY-MM-DD`); ends the actual-spend run. */
  todayYmd: string;
  /** Expected spend for one month, spread evenly across the buckets; omitted for no baseline. */
  monthlyExpected?: MonthlyExpected;
  /** Running totals from `buildComparisonPace`, one per day of the month; month view only. */
  comparisonPace?: readonly number[] | null;
};

/** Which earlier spending the month view overlays, if any. */
export type CumulativeComparison = "none" | "last-month" | "three-month-average";

/** The months each comparison draws on, oldest first, ending the month before `ym`. */
export function comparisonMonthYms(comparison: CumulativeComparison, ym: string): string[] {
  const count = comparison === "last-month" ? 1 : comparison === "three-month-average" ? 3 : 0;
  return Array.from({ length: count }, (_, index) => shiftYm(ym, index - count));
}

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

/**
 * Earlier months' running spend for `comparison`, lined up by day of month against the
 * viewed month `ym`, and averaged when there are several.
 *
 * Months are matched by calendar day, not stretched to fit: day 10 means the 10th in every
 * month, which is how people remember "by this point last month". A shorter month that has
 * already ended holds its final total across the days it does not have. A longer month's
 * extra days fold into the viewed month's last day, so the line still ends on each month's
 * whole total and month end compares with month end. Months with no spend count as zero, as
 * in `resolveMonthlyExpected`; with no spend in any of them there is nothing to draw.
 */
export function buildComparisonPace(
  rows: readonly SpendRow[],
  comparison: CumulativeComparison,
  ym: string,
): number[] | null {
  const priorYms = comparisonMonthYms(comparison, ym);
  if (priorYms.length === 0) return null;
  const monthDays = daysInMonthYm(ym);
  const totals = new Array<number>(monthDays).fill(0);
  let any = false;
  for (const priorYm of priorYms) {
    const byDay = new Array<number>(monthDays).fill(0);
    for (const row of rows) {
      const rowYm = `${row.date.getUTCFullYear()}-${String(row.date.getUTCMonth() + 1).padStart(2, "0")}`;
      if (rowYm !== priorYm) continue;
      const index = Math.min(row.date.getUTCDate(), monthDays) - 1;
      byDay[index] += row.amountCents;
      if (row.amountCents !== 0) any = true;
    }
    let running = 0;
    for (let index = 0; index < monthDays; index += 1) {
      running += byDay[index];
      totals[index] += running;
    }
  }
  if (!any) return null;
  return totals.map((cents) => Math.round(cents / priorYms.length));
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
  { range, ym, custom, todayYmd, monthlyExpected = null, comparisonPace = null }: SeriesOptions,
): CumulativeSpendPoint[] {
  if (range === "custom" && custom && customRangeIsDaily(custom)) return buildDailyRangeSeries(expenses, custom, todayYmd);
  const fromYm = custom?.fromYmd.slice(0, 7);
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
    // YTD runs Jan through the anchor month, a custom range its own months; lifetime spans the months that actually
    // have spend, so an empty log produces an empty chart rather than a bare axis.
    const present = Array.from(buckets.keys()).sort();
    const lastSpendYm = present[present.length - 1];
    let firstYm: string;
    let lastYm: string;
    if (range === "ytd" || range === "custom") {
      // A custom range runs from its first month, as YTD runs from January.
      firstYm = range === "custom" && fromYm ? fromYm : `${ym.slice(0, 4)}-01`;
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
      // By day of month, so it has no meaning once the buckets are months.
      comparisonCents: range === "month" && comparisonPace ? (comparisonPace[index] ?? null) : null,
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
  comparisonGapCents: number | null;
} {
  let last: CumulativeSpendPoint | null = null;
  for (const point of points) {
    if (point.cumulativeCents !== null) last = point;
  }
  const totalCents = last?.cumulativeCents ?? 0;
  const expectedCents = last?.expectedCents ?? null;
  const comparisonCents = last?.comparisonCents ?? null;
  return {
    totalCents,
    expectedCents,
    gapCents: expectedCents === null ? null : totalCents - expectedCents,
    comparisonGapCents: comparisonCents === null ? null : totalCents - comparisonCents,
  };
}

/** Longest custom range drawn day by day; a longer one is drawn by month. */
export const DAILY_CUSTOM_RANGE_MAX_DAYS = 62;

function ymdOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdOf(d);
}

export function customRangeIsDaily(custom: { fromYmd: string; toYmd: string }): boolean {
  const days = (Date.parse(`${custom.toYmd}T00:00:00Z`) - Date.parse(`${custom.fromYmd}T00:00:00Z`)) / 86_400_000 + 1;
  return days <= DAILY_CUSTOM_RANGE_MAX_DAYS;
}

/**
 * A short custom range, one bucket per day. The actual line stops at today (or the last day
 * with spend, if later), like the month view; there is no expected line, which is a monthly
 * figure and would not line up with a range starting mid-month.
 */
function buildDailyRangeSeries(
  expenses: SpendRow[],
  custom: { fromYmd: string; toYmd: string },
  todayYmd: string,
): CumulativeSpendPoint[] {
  const buckets = new Map<string, number>();
  for (const row of expenses) {
    const key = ymdOf(row.date);
    buckets.set(key, (buckets.get(key) ?? 0) + row.amountCents);
  }
  const lastSpend = [...buckets.keys()].sort().at(-1) ?? custom.fromYmd;
  const through = [todayYmd, lastSpend].sort().at(-1)!;
  const short = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  const points: CumulativeSpendPoint[] = [];
  let running = 0;
  for (let day = custom.fromYmd; day <= custom.toYmd; day = addDaysYmd(day, 1)) {
    const bucketCents = buckets.get(day) ?? 0;
    running += bucketCents;
    const label = short.format(new Date(`${day}T00:00:00Z`));
    points.push({
      label,
      fullLabel: label,
      bucketCents,
      cumulativeCents: day <= through ? running : null,
      expectedCents: null,
      comparisonCents: null,
    });
  }
  return points;
}
