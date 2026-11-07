import { describe, expect, it } from 'vitest';

import { budgetLines, lookLines, reviewMonthFrom, scoreLine, spendingChangeLine } from './month-review';

describe('the monthly review', () => {
  it('opens on the month just finished from this month, or on the month shown', () => {
    expect(reviewMonthFrom('2026-11', '2026-11')).toBe('2026-10');
    expect(reviewMonthFrom('2026-01', '2026-11')).toBe('2026-01');
    expect(reviewMonthFrom('2026-01', '2026-01')).toBe('2025-12');
  });

  it('compares spending and the score with the month before', () => {
    expect(spendingChangeLine({ month: '2026-10', spendingCents: 112_000, previousSpendingCents: 100_000 })).toMatch(/^You spent 12% more than in September/);
    expect(spendingChangeLine({ month: '2026-10', spendingCents: 100_000, previousSpendingCents: 100_200 })).toMatch(/^You spent about the same as/);
    expect(spendingChangeLine({ month: '2026-10', spendingCents: 5, previousSpendingCents: 0 })).toBeNull();
    expect(scoreLine({ month: '2026-10', score: 72, previousScore: 68 })).toMatch(/^Financial score 72, up 4 on September/);
    expect(scoreLine({ month: '2026-10', score: 72, previousScore: null })).toBe('Financial score 72');
    expect(scoreLine({ month: '2026-10', score: null, previousScore: 60 })).toBeNull();
  });

  it('says what each budget left and where it goes next month', () => {
    expect(budgetLines({ categoryName: 'Food', spentCents: 60_000, limitCents: 50_000, rollsOver: true }, '2026-10', 'USD')).toEqual({
      status: 'Over by $100.00',
      over: true,
      next: expect.stringMatching(/^Comes off November/),
    });
    expect(budgetLines({ categoryName: 'Fun', spentCents: 10_000, limitCents: 20_000, rollsOver: false }, '2026-10', 'USD')).toEqual({
      status: '$100.00 left',
      over: false,
      next: 'No rollover',
    });
  });

  it('lists what still wants a look', () => {
    expect(lookLines({ bankRowsWaiting: 1, entriesNeedingReview: 3 })).toEqual({
      bank: '1 bank transaction is waiting for review.',
      entries: '3 imported or automatically posted entries need a look.',
    });
  });
});
