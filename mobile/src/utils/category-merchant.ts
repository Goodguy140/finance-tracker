import type { CategoryTrend, MerchantActivity } from '@/api/types';
import { formatCents, formatPeriodMonth } from '@/utils/money';

/** The website's category trend (`/reports/category`) and payee (`/reports/merchant`) pages on the phone. */

export function categoryTrendPath(categoryId: string): string {
  return `/api/v1/categories/${encodeURIComponent(categoryId)}/trend`;
}

export function merchantPath(key: string): string {
  return `/api/v1/merchants?key=${encodeURIComponent(key)}`;
}

export type Tile = { label: string; value: string };

/** This month, where it is heading, its usual month and its budget, as the website's tiles. */
export function trendTiles(trend: CategoryTrend): Tile[] {
  const now = trend.thisMonth;
  if (!now) return [];
  const money = (cents: number) => formatCents(cents, trend.currency);
  return [
    { label: 'This month', value: money(now.cents) },
    ...(now.paceCents !== null ? [{ label: 'On pace for', value: money(now.paceCents) }] : []),
    ...(trend.averageCents !== null
      ? [{ label: trend.averageMonths === 1 ? 'Last month' : `${trend.averageMonths}-month average`, value: money(trend.averageCents) }]
      : []),
    ...(now.budgetCents !== null ? [{ label: 'Budget', value: money(now.budgetCents) }] : []),
  ];
}

export function merchantTiles(m: MerchantActivity): Tile[] {
  const money = (cents: number) => formatCents(cents, m.currency);
  return [
    { label: 'Spent', value: money(m.spentCents) },
    ...(m.receivedCents !== 0 ? [{ label: 'Received', value: money(m.receivedCents) }] : []),
    { label: 'Entries', value: String(m.count) },
    ...(m.averageCents !== null ? [{ label: 'Average', value: money(m.averageCents) }] : []),
  ];
}

/** One bar of the by-month chart. */
export type MonthBar = { month: string; cents: number; budgetCents: number | null; over: boolean };

export function trendBars(trend: CategoryTrend): MonthBar[] {
  // Over budget only means something for spending.
  return trend.months.map((m) => ({
    month: m.month,
    cents: m.cents,
    budgetCents: m.budgetCents,
    over: trend.kind === 'expense' && m.budgetCents !== null && m.cents > m.budgetCents,
  }));
}

export function merchantBars(m: MerchantActivity): MonthBar[] {
  return m.months.map((row) => ({ month: row.month, cents: row.spentCents, budgetCents: null, over: false }));
}

/** "October 2026: $350.00 of a $300.00 budget", for the bar picked or read out. */
export function barLine(bar: MonthBar, currency: string): string {
  const spent = formatCents(bar.cents, currency);
  const budget = bar.budgetCents !== null ? ` of a ${formatCents(bar.budgetCents, currency)} budget` : '';
  return `${formatPeriodMonth(bar.month)}: ${spent}${budget}`;
}

/** The height of the tallest bar or budget line, so every bar fits. Never zero. */
export function barScale(bars: readonly MonthBar[]): number {
  return Math.max(1, ...bars.map((b) => Math.max(b.cents, b.budgetCents ?? 0)));
}

/** "Showing the newest 200 of 340." when the list stops short; null when it is all there. */
export function merchantListNote(m: MerchantActivity): string | null {
  return m.transactions.length < m.count ? `Showing the newest ${m.transactions.length} of ${m.count}.` : null;
}
