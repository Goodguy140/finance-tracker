import type { YearEnd } from '@/api/types';
import type { Tile } from '@/utils/category-merchant';
import { formatCents } from '@/utils/money';

/** The website's year-end summary, on servers that list `year-end` in `/api/v1/me`. */
export function hasYearEnd(me: { features?: string[] } | undefined): boolean {
  return me?.features?.includes('year-end') ?? false;
}

/** The server picks last year (or the only year there is) when none is asked for. */
export function yearEndPath(year: string | null): string {
  return `/api/v1/reports/year${year ? `?year=${encodeURIComponent(year)}` : ''}`;
}

export function yearEndTitle(report: Pick<YearEnd, 'year' | 'toDate'>): string {
  return report.toDate ? `${report.year} so far` : `${report.year} in review`;
}

/** Income, spending, left over or overspent, and how many entries, as the website's tiles. */
export function yearEndTiles(report: Pick<YearEnd, 'totals' | 'currency'>): Tile[] {
  const { totals, currency } = report;
  return [
    { label: 'Income', value: formatCents(totals.incomeCents, currency) },
    { label: 'Spending', value: formatCents(totals.spendingCents, currency) },
    { label: totals.netCents >= 0 ? 'Left over' : 'Overspent', value: formatCents(Math.abs(totals.netCents), currency) },
    { label: 'Entries', value: String(totals.entries) },
  ];
}

/** The website's "Year in review" sentences, each only when there is something to say. */
export function yearInReviewLines(report: Pick<YearEnd, 'year' | 'currency' | 'totals' | 'spendingChangePercent' | 'biggestMonth'>): string[] {
  const { year, currency, totals, spendingChangePercent: change, biggestMonth } = report;
  const lines: string[] = [];
  if (change !== null) {
    const how = change === 0 ? 'about the same as' : `${Math.abs(change)}% ${change > 0 ? 'higher than' : 'lower than'}`;
    lines.push(`Spending was ${how} the same dates in ${year - 1}.`);
  }
  if (biggestMonth) lines.push(`Your biggest month was ${biggestMonth.label}, at ${formatCents(biggestMonth.spendingCents, currency)}.`);
  if (totals.incomeCents > 0) {
    lines.push(
      totals.netCents >= 0
        ? `You kept ${Math.round((totals.netCents / totals.incomeCents) * 100)}% of what came in.`
        : `You spent ${formatCents(-totals.netCents, currency)} more than came in.`,
    );
  }
  return lines;
}

/** A tag's row: how many entries, then what was spent and received, leaving out a side with nothing. */
export function tagTotalsLine(tag: YearEnd['tags'][number], currency: string): string {
  const parts = [`${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`];
  if (tag.spentCents) parts.push(`${formatCents(tag.spentCents, currency)} spent`);
  if (tag.receivedCents) parts.push(`${formatCents(tag.receivedCents, currency)} received`);
  return parts.join(' · ');
}
