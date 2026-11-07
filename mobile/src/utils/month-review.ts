import type { MonthReview } from '@/api/types';
import { shiftMonth } from '@/utils/dates';
import { formatCents, formatPeriodMonth } from '@/utils/money';

/** The website's monthly review (`/reports/month`) on the phone. */

export const CLOSE_PATH = '/api/v1/month-review/close';

export function monthReviewPath(month: string | null): string {
  return `/api/v1/month-review${month ? `?month=${month}` : ''}`;
}

/** Opened from Budgets: the month shown there, or the month just finished when that is this month. */
export function reviewMonthFrom(shown: string, currentMonth: string): string {
  return shown >= currentMonth ? shiftMonth(currentMonth, -1) : shown;
}

/** "You spent 12% more than in September.", or null without a month before to compare. */
export function spendingChangeLine(review: Pick<MonthReview, 'month' | 'spendingCents' | 'previousSpendingCents'>): string | null {
  const { spendingCents: now, previousSpendingCents: before } = review;
  if (before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  const how = pct === 0 ? 'about the same as' : `${Math.abs(pct)}% ${pct > 0 ? 'more than' : 'less than'}`;
  return `You spent ${how} in ${formatPeriodMonth(shiftMonth(review.month, -1))}.`;
}

/** "Score 72, up 4 on September", "Score 72", or null when no score was saved for the month. */
export function scoreLine(review: Pick<MonthReview, 'month' | 'score' | 'previousScore'>): string | null {
  if (review.score === null) return null;
  const before = review.previousScore;
  if (before === null || before === review.score) return `Financial score ${review.score}`;
  return `Financial score ${review.score}, ${review.score > before ? 'up' : 'down'} ${Math.abs(review.score - before)} on ${formatPeriodMonth(shiftMonth(review.month, -1))}`;
}

/** "$40.00 left" or "Over by $15.00", and where it goes next month. */
export function budgetLines(b: MonthReview['budgets'][number], month: string, currency: string): { status: string; over: boolean; next: string } {
  const left = b.limitCents - b.spentCents;
  const next = formatPeriodMonth(shiftMonth(month, 1));
  return {
    status: left < 0 ? `Over by ${formatCents(-left, currency)}` : `${formatCents(left, currency)} left`,
    over: left < 0,
    next: b.rollsOver ? `${left < 0 ? 'Comes off' : 'Rolls into'} ${next}` : 'No rollover',
  };
}

/** What still wants a look before closing, as the website's "Close the month" lists it. */
export function lookLines(review: Pick<MonthReview, 'bankRowsWaiting' | 'entriesNeedingReview'>): { bank: string; entries: string } {
  const b = review.bankRowsWaiting;
  const e = review.entriesNeedingReview;
  return {
    bank: b === 0 ? 'No bank transactions are waiting for review.' : `${b} bank transaction${b === 1 ? ' is' : 's are'} waiting for review.`,
    entries:
      e === 0
        ? 'Every imported or automatically posted entry has been looked at.'
        : `${e} imported or automatically posted entr${e === 1 ? 'y needs' : 'ies need'} a look.`,
  };
}
