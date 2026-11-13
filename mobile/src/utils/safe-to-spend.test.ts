import { describe, expect, it } from 'vitest';

import type { SafeToSpend } from '@/api/types';
import { bufferDaysChange, safeToSpendBreakdown, safeToSpendBufferLine, safeToSpendLine } from './safe-to-spend';

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

const sum = (data: SafeToSpend) =>
  safeToSpendBreakdown(data).reduce((total, row) => total + (row.sign === '+' ? row.cents : -row.cents), 0);

describe('safeToSpendBreakdown', () => {
  it('adds up to the number it explains', () => {
    expect(sum(base)).toBe(base.safeCents);
  });

  it("shows next month's bills in the buffer, and still adds up", () => {
    const buffered: SafeToSpend = { ...base, safeCents: -105_000, bufferDays: 7, bufferUntilYmd: '2026-12-04', bufferBillsCents: 150_000 };
    expect(safeToSpendBreakdown(buffered).map((row) => row.label)).toContain("Next month's bills to Dec 4");
    expect(sum(buffered)).toBe(buffered.safeCents);
    expect(safeToSpendBufferLine(buffered)).toBe("Also holding back next month's bills due by Dec 4 (7-day buffer).");
    // A buffer that ends inside the month, or a server from before the buffer: no row, no line.
    expect(safeToSpendBreakdown({ ...base, bufferDays: 3, bufferUntilYmd: null, bufferBillsCents: 0 })).toHaveLength(6);
    expect(safeToSpendBufferLine(base)).toBeNull();
  });
});

describe('bufferDaysChange', () => {
  it('gives the PATCH body the server takes, clears on empty, and skips what is already saved', () => {
    // Exactly `{ bufferDays }`: the server refuses any other key.
    expect(bufferDaysChange(' 7 ', null, 60)).toStrictEqual({ bufferDays: 7 });
    expect(bufferDaysChange('13', 7, 60)).toStrictEqual({ bufferDays: 13 });
    expect(bufferDaysChange('', 7, 60)).toStrictEqual({ bufferDays: null });
    expect(bufferDaysChange('', null, 60)).toBeNull();
    expect(bufferDaysChange('7', 7, 60)).toBeNull();
    for (const bad of ['0', '61', '2.5', '-3', 'soon']) expect(bufferDaysChange(bad, null, 60)).toHaveProperty('error');
  });
});
