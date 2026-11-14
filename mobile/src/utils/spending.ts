import type { Spending, SpendingComparison } from '@/api/types';
import { formatCents, formatPeriodMonth } from '@/utils/money';
import { periodQuery, storedPeriod, type PeriodChoice } from '@/utils/period';

/**
 * The Home screen's two spending charts: what to ask the server for, what to say about the numbers,
 * and where on the screen each line goes. The server works every number out
 * (`src/lib/api-v1/spending.ts`); this only lays them out.
 */

export const SPENDING_PATH = '/api/v1/spending';

/** Home's two charts, in the order the website's phone carousel shows them. */
export const SPENDING_CHARTS = ['categories', 'cumulative', 'calendar'] as const;

/**
 * What the person picked on the phone: Compare with and Show savings (left out, they follow the
 * website's card), and which chart Home shows.
 */
export type SpendingOptions = {
  compareWith?: SpendingComparison;
  showSavings?: boolean;
  chart?: (typeof SPENDING_CHARTS)[number];
  /** This month (the default), year to date or a custom range, on servers that have them. */
  period?: PeriodChoice;
};

export function spendingPath(options: SpendingOptions, periods = false): string {
  // Kept on the phone, so read back with care; a server without periods is never asked for one.
  const period = periods ? storedPeriod(options.period) : undefined;
  const params: string[] = period ? periodQuery(period) : [];
  if (options.compareWith) params.push(`compare=${options.compareWith}`);
  if (options.showSavings !== undefined) params.push(`savings=${options.showSavings ? '1' : '0'}`);
  return params.length ? `${SPENDING_PATH}?${params.join('&')}` : SPENDING_PATH;
}

export const COMPARE_OPTIONS: readonly { value: SpendingComparison; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'last-month', label: 'Last month' },
  { value: 'three-month-average', label: '3-month avg' },
];

const COMPARISON_NAME: Record<Exclude<SpendingComparison, 'none'>, { legend: string; gap: string }> = {
  'last-month': { legend: 'Last month', gap: 'last month' },
  'three-month-average': { legend: '3-month average', gap: 'the 3-month average' },
};

export function comparisonLegend(compareWith: SpendingComparison): string | null {
  return compareWith === 'none' ? null : COMPARISON_NAME[compareWith].legend;
}

export function expectedLegend(basis: Spending['cumulative']['expectedBasis']): string | null {
  if (basis === 'budgets') return 'Expected pace from your budgets';
  if (basis === 'average') return 'Expected pace from your last 3 months';
  return null;
}

export type Tone = 'positive' | 'danger';

/** "$80.00 under expected", as the website's card heading says it. */
export function expectedGapLine(data: Spending): { text: string; tone: Tone } | null {
  const gap = data.cumulative.expectedGapCents;
  if (gap === null || data.cumulative.expectedBasis === null) return null;
  return { text: `${formatCents(Math.abs(gap), data.currency)} ${gap > 0 ? 'over' : 'under'} expected`, tone: gap > 0 ? 'danger' : 'positive' };
}

/** "$20.00 less than last month"; a note instead when the earlier months had nothing in them. */
export function comparisonLine(data: Spending): { text: string; tone: Tone | null } | null {
  if (data.compareWith === 'none') return null;
  const names = COMPARISON_NAME[data.compareWith];
  const gap = data.cumulative.comparisonGapCents;
  if (gap === null) {
    return { text: `Nothing spent in ${data.compareWith === 'last-month' ? 'last month' : 'the last 3 months'} to compare with.`, tone: null };
  }
  return {
    text: `${formatCents(Math.abs(gap), data.currency)} ${gap > 0 ? 'more' : 'less'} than ${names.gap}`,
    tone: gap > 0 ? 'danger' : 'positive',
  };
}

/**
 * What the card says about one day while a finger is on the chart: its running total in place of
 * the month's, then the day, what was spent that day, and the other lines' values.
 */
export function dayDetail(data: Spending, index: number): { total: string; lines: string[] } | null {
  const day = data.cumulative.days[index];
  if (!day) return null;
  const money = (cents: number) => formatCents(cents, data.currency);
  const byMonth = data.cumulative.granularity === 'month';
  const lines = [day.fullLabel && isRangeData(data) ? day.fullLabel : dayLabel(data.month, day.day)];
  if (day.spentCents !== 0) lines.push(`${day.spentCents > 0 ? '+' : '−'}${money(Math.abs(day.spentCents))} that ${byMonth ? 'month' : 'day'}`);
  if (day.expectedCents !== null) lines.push(`${money(day.expectedCents)} expected`);
  const legend = comparisonLegend(data.compareWith);
  if (legend && day.comparisonCents !== null) lines.push(`${money(day.comparisonCents)} ${legend.toLowerCase()}`);
  return { total: day.totalCents === null ? 'Not yet' : money(day.totalCents), lines };
}

function isRangeData(data: Spending): boolean {
  return data.period !== undefined && data.period.range !== 'month';
}

/** What the card heading names: the month, or the year to date or range shown. */
export function periodTitle(data: Spending): string {
  return isRangeData(data) && data.period ? data.period.label : formatPeriodMonth(data.month);
}

/** The points the date axis labels: by day as in a month (`dayTicks`), or for months about five of them. */
export function chartTicks(data: Spending): number[] {
  const count = data.cumulative.days.length;
  if (data.cumulative.granularity !== 'month') return dayTicks(count);
  const step = Math.max(1, Math.ceil(count / 5));
  const ticks = [];
  for (let i = 1; i <= count; i += step) ticks.push(i);
  return ticks;
}

/** The label under a point on the date axis: the day of a month, or the server's label in a range. */
export function tickLabel(data: Spending, position: number): string {
  if (!isRangeData(data)) return String(position);
  return data.cumulative.days[position - 1]?.label ?? String(position);
}

/** "Nov 6" for day 6 of 2026-11. */
export function dayLabel(month: string, day: number, locale?: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Short axis amounts, as the website's chart writes them: 850, 1.2k. */
export function axisAmount(cents: number): string {
  const units = cents / 100;
  if (Math.abs(units) >= 1_000) return `${Math.round(units / 100) / 10}k`;
  return String(Math.round(units));
}

/**
 * The top of the amount axis and its ticks: a round step (1, 2, 2.5 or 5 times a power of ten)
 * that splits the axis into at most four, with the highest line drawn at or above `maxCents`.
 */
export function amountAxis(maxCents: number): { maxCents: number; ticks: number[] } {
  const top = Math.max(maxCents, 1_000);
  const rough = top / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const count = Math.ceil(top / step);
  return { maxCents: step * count, ticks: Array.from({ length: count + 1 }, (_, i) => step * i) };
}

/** The highest value any line reaches, for the axis. */
export function chartMaxCents(days: Spending['cumulative']['days']): number {
  let max = 0;
  for (const day of days) max = Math.max(max, day.totalCents ?? 0, day.expectedCents ?? 0, day.comparisonCents ?? 0);
  return max;
}

/** The days the date axis labels: the 1st, every week after, and the last when there is room. */
export function dayTicks(count: number): number[] {
  const ticks = [];
  for (let day = 1; day <= count; day += 7) ticks.push(day);
  if (count - ticks[ticks.length - 1] >= 4) ticks.push(count);
  return ticks;
}

export type Point = { x: number; y: number };

/**
 * One line's points in a `width` × `height` box, day 1 at the left edge and the last day at the
 * right, zero at the bottom. A day with no value breaks the line, so the actual line stops at today.
 */
export function linePoints(values: readonly (number | null)[], width: number, height: number, maxCents: number): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  const last = Math.max(values.length - 1, 1);
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: (index / last) * width, y: height - (Math.max(value, 0) / maxCents) * height });
  });
  if (run.length) runs.push(run);
  return runs;
}

/** A straight piece of line, drawn as a thin view `length` wide centred on (`cx`, `cy`) and turned by `angle` radians. */
export type Segment = { cx: number; cy: number; length: number; angle: number };

function segment(a: Point, b: Point): Segment {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    length: Math.hypot(b.x - a.x, b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

export function solidSegments(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i += 1) out.push(segment(points[i - 1], points[i]));
  return out;
}

/** The same line as dashes `dash` long with `gap` between, carried on across its corners. */
export function dashedSegments(points: readonly Point[], dash: number, gap: number): Segment[] {
  const out: Segment[] = [];
  // How far into the current dash-and-gap pattern the line has got.
  let phase = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const at = (t: number): Point => ({ x: a.x + ((b.x - a.x) * t) / length, y: a.y + ((b.y - a.y) * t) / length });
    let travelled = 0;
    while (travelled < length) {
      const inDash = phase < dash;
      const step = Math.min(length - travelled, inDash ? dash - phase : dash + gap - phase);
      if (inDash && step > 0) out.push(segment(at(travelled), at(travelled + step)));
      travelled += step;
      phase = (phase + step) % (dash + gap);
    }
  }
  return out;
}

/** The day under a finger at `x` across a chart `width` wide, as an index into the days. */
export function dayIndexAt(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((x / width) * (count - 1))));
}

/** Each slice's share of the pie, in whole percent, sized as the pie sizes it (refunds by their amount). */
export function sliceShares(slices: readonly { cents: number }[]): number[] {
  const total = slices.reduce((sum, slice) => sum + Math.abs(slice.cents), 0);
  return slices.map((slice) => (total === 0 ? 0 : Math.round((Math.abs(slice.cents) / total) * 100)));
}

/** What the pie card says under its slices about Savings, when the slice is on. */
export function savingsNote(data: Spending): string | null {
  const savings = data.categories.savings;
  if (!data.showSavings || !savings) return null;
  if (savings.accounts === 0) return 'No account counts as savings yet. Turn on Counts as savings for one on the website, under Settings → Accounts.';
  if (savings.cents === 0) return 'Nothing moved into savings accounts this month.';
  return `Savings: ${formatCents(savings.cents, data.currency)} moved into savings accounts, net of what came back out.`;
}
