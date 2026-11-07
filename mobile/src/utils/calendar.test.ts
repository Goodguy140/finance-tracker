import { describe, expect, it } from 'vitest';

import type { CalendarBill, CalendarDay } from '@/api/types';

import { billDot, billKind, compactCents, dayLine } from './calendar';

const bill = (overrides: Partial<CalendarBill> = {}): CalendarBill => ({
  name: 'Rent',
  type: 'expense',
  cents: 150_000,
  overdue: false,
  planned: false,
  cardPayment: false,
  ...overrides,
});

describe('calendar', () => {
  it('shortens a day amount to fit its cell', () => {
    expect(compactCents(4_550, 'USD')).toBe('$46');
    expect(compactCents(123_400, 'USD')).toBe('$1.2k');
    expect(compactCents(1_234_500, 'USD')).toBe('$12k');
    expect(compactCents(-200, 'USD')).toBe('-$2');
  });

  it('colours the dots as the website does: unposted red, moves violet, pay green, plans ringed', () => {
    expect(billDot(bill())).toEqual({ tone: 'tint', ringed: false });
    expect(billDot(bill({ overdue: true, type: 'income' }))).toEqual({ tone: 'danger', ringed: false });
    expect(billDot(bill({ type: 'transfer', cardPayment: true }))).toEqual({ tone: 'chartExpected', ringed: false });
    expect(billDot(bill({ type: 'income', planned: true }))).toEqual({ tone: 'positive', ringed: true });
    expect(billKind(bill({ type: 'transfer', cardPayment: true }))).toBe('Card payment');
    expect(billKind(bill({ planned: true }))).toBe('Planned');
  });

  it('sums up a picked day', () => {
    const day: CalendarDay = { date: '2026-03-03', day: 3, inMonth: true, spentCents: 1_500, incomeCents: 0, count: 2, bills: [] };
    expect(dayLine(day, 'USD')).toBe('Spent $15.00 · 2 entries');
    expect(dayLine({ ...day, spentCents: 0, count: 0 }, 'USD')).toBe('Nothing logged');
  });
});
