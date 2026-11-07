import type { ForecastEntry, Me } from '@/api/types';
import { formatDate } from '@/utils/dates';
import { formatCents } from '@/utils/money';

/** The website's Upcoming bills card on the phone. */

export const FORECAST_DAYS = [30, 60, 90] as const;
export type ForecastDays = (typeof FORECAST_DAYS)[number];

export function forecastPath(days: ForecastDays, includeTransfers: boolean): string {
  return `/api/v1/bills/forecast?days=${days}&transfers=${includeTransfers}`;
}

export function canForecast(me: Me | undefined): boolean {
  return me?.features?.includes('forecast') ?? false;
}

/** "+$685.00", "-$1,515.00": the running net beside each day. */
export function signedCents(cents: number, currency: string): string {
  return `${cents < 0 ? '-' : '+'}${formatCents(Math.abs(cents), currency)}`;
}

/** The quiet line under a name: the category, the accounts a transfer moves between, or a card's balance. */
export function entryDetail(entry: ForecastEntry, currency: string): string {
  if (!entry.card) return entry.label;
  if (entry.card.owedCents !== null) {
    return `Balance owed${entry.card.minimumCents ? `, minimum ${formatCents(entry.card.minimumCents, currency)}` : ''}`;
  }
  return entry.card.minimumCents ? 'Minimum payment' : 'No balance recorded';
}

export type ForecastChip = { text: string; tone: 'tint' | 'warning' | 'danger' | 'muted' };

/** The website's chips, in its order: Card payment or Transfer, Decide by, Planned, Overdue, Unposted since. */
export function entryChips(entry: ForecastEntry): ForecastChip[] {
  const chips: ForecastChip[] = [];
  if (entry.card) chips.push({ text: 'Card payment', tone: 'muted' });
  else if (entry.type === 'transfer') chips.push({ text: 'Transfer', tone: 'muted' });
  if (entry.decideBy) chips.push({ text: `Decide by ${formatDate(entry.decideBy)}`, tone: 'warning' });
  if (entry.planned) chips.push({ text: 'Planned', tone: 'tint' });
  if (entry.overdue) chips.push({ text: 'Overdue', tone: 'danger' });
  if (entry.missedSince) chips.push({ text: `Unposted since ${formatDate(entry.missedSince)}`, tone: 'muted' });
  return chips;
}

/** "-$15.00", "+$3,000.00", or a transfer's plain amount ("Due" with none known). */
export function entryAmount(entry: ForecastEntry, currency: string): string {
  if (entry.type === 'transfer') return entry.amountCents === null ? 'Due' : formatCents(entry.amountCents, currency);
  return `${entry.type === 'income' ? '+' : '-'}${formatCents(entry.amountCents ?? 0, currency)}`;
}
