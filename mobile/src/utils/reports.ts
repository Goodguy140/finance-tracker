import type { Reports } from '@/api/types';
import type { Tile } from '@/utils/category-merchant';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

/** The website's Reports page, on servers that list `reports` in `/api/v1/me`. */
export function hasReports(me: { features?: string[] } | undefined): boolean {
  return me?.features?.includes('reports') ?? false;
}

/** The period the screen shows: one of the server's choices, or a custom range of days. */
export type ReportsPeriod = { kind: 'option'; key: string } | { kind: 'custom'; from: string; to: string };

export function reportsPath(period: ReportsPeriod, tagId: string | null): string {
  const params = new URLSearchParams();
  if (period.kind === 'custom') {
    params.set('from', period.from);
    params.set('to', period.to);
  } else if (period.key !== '12m') {
    params.set('period', period.key);
  }
  if (tagId) params.set('tagId', tagId);
  const query = params.toString();
  return `/api/v1/reports${query ? `?${query}` : ''}`;
}

/** The headline figures: income, spending, and left over (or saved) and saved by transfer, as the website's tiles. */
export function totalsTiles(totals: Reports['totals'], currency: string): Tile[] {
  const money = (cents: number) => formatCents(Math.abs(cents), currency);
  const tiles: Tile[] = [
    { label: 'Income', value: formatCents(totals.incomeCents, currency) },
    { label: 'Spending', value: formatCents(totals.spendingCents, currency) },
  ];
  if (totals.toSavingsCents === null) {
    tiles.push({ label: totals.netCents >= 0 ? 'Saved' : 'Overspent', value: money(totals.netCents) });
  } else {
    tiles.push({ label: totals.netCents >= 0 ? 'Left over' : 'Overspent', value: money(totals.netCents) });
    tiles.push({ label: totals.toSavingsCents >= 0 ? 'Saved' : 'Taken from savings', value: money(totals.toSavingsCents) });
  }
  return tiles;
}

/** A group of bars for one month: each value with its colour key, positive or negative. */
export type BarGroup = { key: string; label: string; values: { cents: number; tone: 'positive' | 'tint' | 'danger' }[]; caption: string };

export function incomeSpendingBars(months: Reports['months'], currency: string): BarGroup[] {
  return months.map((m) => ({
    key: m.ym,
    label: m.label,
    values: [
      { cents: m.incomeCents, tone: 'positive' as const },
      { cents: m.spendingCents, tone: 'tint' as const },
    ],
    caption: `${m.label}: ${formatCents(m.incomeCents, currency)} in, ${formatCents(m.spendingCents, currency)} out, ${
      m.netCents >= 0 ? `${formatCents(m.netCents, currency)} left over` : `${formatCents(-m.netCents, currency)} overspent`
    }${m.toSavingsCents ? `, ${formatCents(m.toSavingsCents, currency)} to savings` : ''}`,
  }));
}

export function netWorthBars(points: Reports['netWorth']['points'], currency: string): BarGroup[] {
  return points.map((p) => ({
    key: p.ym,
    label: p.label,
    values: [{ cents: p.netCents, tone: p.netCents < 0 ? ('danger' as const) : ('tint' as const) }],
    caption: `${p.label}: ${formatCents(p.netCents, currency)} (${formatCents(p.assetsCents, currency)} held, ${formatCents(p.liabilitiesCents, currency)} owed)`,
  }));
}

/** The highest and lowest a bar reaches, with zero always inside, so negatives hang below the line. */
export function barExtent(groups: readonly BarGroup[]): { max: number; min: number } {
  const all = groups.flatMap((g) => g.values.map((v) => v.cents));
  return { max: Math.max(0, ...all), min: Math.min(0, ...all) };
}

/** "+12%", "−8%", or "New" when last year had nothing, as the website's Change column. */
export function changeText(ratio: number | null): string {
  if (ratio === null) return 'New';
  const pct = Math.round(ratio * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

/** Net worth today and at each horizon, with the change from today, as the website's tiles. */
export function projectionTiles(projection: NonNullable<Reports['projection']>, currency: string): Tile[] {
  const today = projection.netCents[0];
  return [
    { label: 'Net worth today', value: formatCents(today, currency) },
    ...projection.days.map((days, i) => {
      const cents = projection.netCents[i + 1];
      const change = cents - today;
      return {
        label: `In ${days} days`,
        value: `${formatCents(cents, currency)} (${change >= 0 ? '+' : '−'}${formatCents(Math.abs(change), currency)})`,
      };
    }),
  ];
}

/** "Chequing goes below zero on Thu, Dec 3 and reaches −$700.00." for each account that does. */
export function belowZeroLines(projection: NonNullable<Reports['projection']>, currency: string): string[] {
  return projection.accounts
    .filter((a) => a.belowZero)
    .map((a) => `${a.name} goes below zero on ${formatDay(a.belowZero!.date)} and reaches ${formatCents(a.belowZero!.lowestCents, currency)}.`);
}
