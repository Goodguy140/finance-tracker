import { describe, expect, it } from 'vitest';

import type { SafeToSpend } from '@/api/types';
import { safeToSpendBreakdown, safeToSpendLine } from './safe-to-spend';

const base: SafeToSpend = {
  safeCents: 45_000,
  perDayCents: 3_000,
  daysLeft: 15,
  incomeReceivedCents: 400_000,
  spentCents: 150_000,
  expectedIncomeCents: 10_000,
  billsDueCents: 20_000,
  budgetLeftCents: 185_000,
  goalsCents: 10_000,
};

describe('safeToSpendLine', () => {
  it('spreads what is free over the days left', () => {
    expect(safeToSpendLine(base, 'USD')).toBe('About $30.00 a day for 15 days.');
    expect(safeToSpendLine({ ...base, daysLeft: 1, perDayCents: 45_000 }, 'USD')).toBe('About $450.00 a day for 1 day.');
  });

  it('says by how much the month is over-committed', () => {
    expect(safeToSpendLine({ ...base, safeCents: -12_345, perDayCents: 0 }, 'USD')).toBe(
      'Over-committed by $123.45 for the rest of the month.',
    );
  });
});

describe('safeToSpendBreakdown', () => {
  it('adds up to the number it explains', () => {
    const total = safeToSpendBreakdown(base).reduce((sum, row) => sum + (row.sign === '+' ? row.cents : -row.cents), 0);
    expect(total).toBe(base.safeCents);
  });
});
