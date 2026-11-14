import { describe, expect, it } from 'vitest';

import type { Me, ZeroBased } from '@/api/types';
import { canUseZeroBased, zeroBasedBreakdown, zeroBasedLine, zeroBasedOverspent, zeroBasedTone } from '@/utils/zero-based';

const base: ZeroBased = {
  toAssignCents: 25_000,
  incomeCents: 300_000,
  assignedCents: 200_000,
  billsOutsideBudgetsCents: 50_000,
  spentOutsideBudgetsCents: 15_000,
  goalsCents: 10_000,
  overspent: [],
  overspentCents: 0,
};

describe('canUseZeroBased', () => {
  it('needs a server that sends To assign', () => {
    expect(canUseZeroBased({ features: ['reports', 'zero-based'] } as Me)).toBe(true);
    expect(canUseZeroBased({ features: ['reports'] } as Me)).toBe(false);
    expect(canUseZeroBased(undefined)).toBe(false);
  });
});

describe('zeroBasedLine and zeroBasedTone', () => {
  it('asks for a job for money left, says when every dollar has one, and says by how much it is over', () => {
    expect(zeroBasedLine(base, 'USD')).toBe('Give this money a job: raise a budget or a savings goal.');
    expect(zeroBasedTone(base)).toBe('positive');
    expect(zeroBasedLine({ ...base, toAssignCents: 0 }, 'USD')).toBe('Every dollar has a job.');
    expect(zeroBasedTone({ ...base, toAssignCents: 0 })).toBe('plain');
    expect(zeroBasedLine({ ...base, toAssignCents: -4_250 }, 'USD')).toBe(
      "Assigned $42.50 more than this month's income. Lower a budget to balance.",
    );
    expect(zeroBasedTone({ ...base, toAssignCents: -1 })).toBe('danger');
  });
});

describe('zeroBasedOverspent', () => {
  it('is nothing when no budget is over, and the four largest with their total otherwise', () => {
    expect(zeroBasedOverspent(base, 'USD')).toBeNull();
    const overspent = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ categoryId: name, categoryName: name, overCents: 1_000 - i }));
    const result = zeroBasedOverspent({ ...base, overspent, overspentCents: 4_990 }, 'USD');
    expect(result?.line).toBe('$49.90 overspent to cover. Move money in from another budget.');
    expect(result?.rows.map((r) => r.categoryId)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('zeroBasedBreakdown', () => {
  it('adds up to the number it explains', () => {
    const rows = zeroBasedBreakdown(base);
    expect(rows.map((r) => r.label)).toEqual([
      'Income this month',
      'Assigned to budgets',
      'Bills outside budgets',
      'Spent outside budgets',
      'Savings goals this month',
    ]);
    expect(rows.reduce((sum, r) => sum + (r.sign === '+' ? r.cents : -r.cents), 0)).toBe(base.toAssignCents);
  });
});
