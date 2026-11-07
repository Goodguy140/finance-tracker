import { describe, expect, it } from 'vitest';

import type { CategoryTrend, MerchantActivity } from '@/api/types';

import { barLine, barScale, merchantListNote, merchantPath, merchantTiles, trendBars, trendTiles } from './category-merchant';

const trend: CategoryTrend = {
  categoryId: 'food',
  name: 'Food',
  kind: 'expense',
  groupName: null,
  currency: 'USD',
  months: [
    { month: '2026-09', label: 'Sep', cents: 35_000, budgetCents: 30_000 },
    { month: '2026-10', label: 'Oct', cents: 20_000, budgetCents: 30_000 },
    { month: '2026-11', label: 'Nov', cents: 9_000, budgetCents: null },
  ],
  averageCents: 27_500,
  averageMonths: 2,
  thisMonth: { cents: 9_000, paceCents: null, budgetCents: 30_000 },
  payees: [],
  biggest: [],
};

describe('category page', () => {
  it('shows the tiles the website shows, leaving out what it has no figure for', () => {
    expect(trendTiles(trend)).toEqual([
      { label: 'This month', value: '$90.00' },
      { label: '2-month average', value: '$275.00' },
      { label: 'Budget', value: '$300.00' },
    ]);
    expect(trendTiles({ ...trend, averageMonths: 1, averageCents: 100, thisMonth: { cents: 0, paceCents: 500, budgetCents: null } })).toEqual([
      { label: 'This month', value: '$0.00' },
      { label: 'On pace for', value: '$5.00' },
      { label: 'Last month', value: '$1.00' },
    ]);
    expect(trendTiles({ ...trend, thisMonth: null })).toEqual([]);
  });

  it('marks the months over budget, only for spending, and scales to the tallest bar or budget', () => {
    expect(trendBars(trend).map((b) => b.over)).toEqual([true, false, false]);
    expect(trendBars({ ...trend, kind: 'income' }).some((b) => b.over)).toBe(false);
    expect(barScale(trendBars(trend))).toBe(35_000);
    expect(barScale(trendBars({ ...trend, months: [{ month: '2026-11', label: 'Nov', cents: 100, budgetCents: 400 }] }))).toBe(400);
    expect(barScale([])).toBe(1);
    expect(barLine(trendBars(trend)[0], 'USD')).toBe('September 2026: $350.00 of a $300.00 budget');
    expect(barLine(trendBars(trend)[2], 'USD')).toBe('November 2026: $90.00');
  });
});

describe('payee page', () => {
  const merchant: MerchantActivity = {
    key: 'tim hortons #12',
    label: 'Tim Hortons',
    currency: 'USD',
    firstDate: '2026-01-02',
    lastDate: '2026-11-01',
    spentCents: 3_000,
    receivedCents: 0,
    count: 3,
    averageCents: 1_000,
    months: [],
    categories: [],
    transactions: [{ id: 'a', date: '2026-11-01', title: 'Tim Hortons', type: 'expense', amountCents: 1_000, categoryName: 'Coffee', split: false }],
  };

  it('escapes the key, shows Received only when there is some, and says when the list stops short', () => {
    expect(merchantPath(merchant.key)).toBe('/api/v1/merchants?key=tim%20hortons%20%2312');
    expect(merchantTiles(merchant).map((t) => t.label)).toEqual(['Spent', 'Entries', 'Average']);
    expect(merchantTiles({ ...merchant, receivedCents: 500, averageCents: null }).map((t) => t.label)).toEqual(['Spent', 'Received', 'Entries']);
    expect(merchantListNote(merchant)).toBe('Showing the newest 1 of 3.');
    expect(merchantListNote({ ...merchant, count: 1 })).toBeNull();
  });
});
