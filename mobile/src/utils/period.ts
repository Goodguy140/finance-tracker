import type { AppPeriod, Me } from '@/api/types';

/**
 * Year to date and custom ranges on the phone, as the website's period filter has them. The
 * server works out every number for the period; this only says what to ask for.
 */

export type PeriodChoice = { kind: 'month' } | { kind: 'ytd' } | { kind: 'custom'; from: string; to: string };

/** The server shows budgets and the spending charts for a year to date or a custom range. */
export function canPickPeriod(me: Me | undefined): boolean {
  return me?.features?.includes('periods') ?? false;
}

/**
 * The query for a period: `month` is the month shown, or the last month of year to date; left out,
 * the server's this month. A custom range carries its own days.
 */
export function periodQuery(choice: PeriodChoice, month?: string | null): string[] {
  if (choice.kind === 'custom') return ['range=custom', `from=${choice.from}`, `to=${choice.to}`];
  const params = choice.kind === 'ytd' ? ['range=ytd'] : [];
  if (month) params.push(`month=${month}`);
  return params;
}

/** Whether the answer is for more than one month, so a month's own tools (editing, comparing, the review) don't apply. */
export function isRange(period: AppPeriod | undefined): boolean {
  return period !== undefined && period.range !== 'month';
}

/** The custom range a picker starts from: the one shown, or the year so far. */
export function initialRange(choice: PeriodChoice, today: string): { from: string; to: string } {
  return choice.kind === 'custom' ? { from: choice.from, to: choice.to } : { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** A choice read back from storage, or nothing when it isn't one. */
export function storedPeriod(value: unknown): PeriodChoice | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === 'month' || v.kind === 'ytd') return { kind: v.kind };
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (v.kind === 'custom' && typeof v.from === 'string' && typeof v.to === 'string' && day.test(v.from) && day.test(v.to) && v.from <= v.to) {
    return { kind: 'custom', from: v.from, to: v.to };
  }
  return undefined;
}
