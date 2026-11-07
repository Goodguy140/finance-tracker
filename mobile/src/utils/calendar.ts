import type { CalendarBill, CalendarDay, Me } from '@/api/types';
import { formatCents } from '@/utils/money';

/** The website's Calendar card on the phone, a page of Home's spending charts. */

export function calendarPath(month: string): string {
  return `/api/v1/calendar?month=${month}`;
}

export function canShowCalendar(me: Me | undefined): boolean {
  return me?.features?.includes('calendar') ?? false;
}

export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** "$45", "$1.2k", "$12k": a day's amount that fits a seventh of a phone's width. */
export function compactCents(cents: number, currency: string): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  const whole = (value: number, digits: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
    } catch {
      return `${value.toFixed(digits)} ${currency}`;
    }
  };
  if (abs >= 1_000_000) return `${sign}${whole(Math.round(abs / 100_000), 0)}k`;
  if (abs >= 100_000) return `${sign}${whole(Math.round(abs / 10_000) / 10, 1)}k`;
  return `${sign}${whole(Math.round(abs / 100), 0)}`;
}

export type DotTone = 'danger' | 'positive' | 'tint' | 'chartExpected';

/** The website's dots: red while unposted, violet for a transfer or card payment, green for pay, else the bill colour. */
export function billDot(bill: CalendarBill): { tone: DotTone; ringed: boolean } {
  const tone: DotTone = bill.overdue ? 'danger' : bill.type === 'transfer' ? 'chartExpected' : bill.type === 'income' ? 'positive' : 'tint';
  return { tone, ringed: bill.planned };
}

/** "Spent $15.00 · Income $2,500.00 · 3 entries", the line under a picked day. */
export function dayLine(day: CalendarDay, currency: string): string {
  const parts = [
    day.spentCents !== 0 ? `Spent ${formatCents(day.spentCents, currency)}` : null,
    day.incomeCents !== 0 ? `Income ${formatCents(day.incomeCents, currency)}` : null,
    day.count > 0 ? `${day.count} ${day.count === 1 ? 'entry' : 'entries'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing logged';
}

/** What a due bill is, beside its amount: Overdue, Planned, Card payment, Transfer, Pay or Bill. */
export function billKind(bill: CalendarBill): string {
  if (bill.overdue) return 'Overdue';
  if (bill.planned) return 'Planned';
  if (bill.cardPayment) return 'Card payment';
  if (bill.type === 'transfer') return 'Transfer';
  return bill.type === 'income' ? 'Pay' : 'Bill';
}
