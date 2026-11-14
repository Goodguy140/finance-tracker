import { describe, expect, it } from 'vitest';

import type { BudgetRow, Budgets } from '@/api/types';
import { budgetFormFor, budgetPatch, canEditBudgets, coverPlan, coverPrefill, coverSources } from './budget-edits';

function row(categoryId: string, limitCents: number, spentCents: number, extra: Partial<BudgetRow> = {}): BudgetRow {
  return {
    categoryId,
    categoryName: categoryId[0].toUpperCase() + categoryId.slice(1),
    limitCents,
    monthlyLimitCents: limitCents,
    rolloverCents: 0,
    spentCents,
    percentUsed: 0,
    ...extra,
  };
}

const data: Budgets = {
  periodMonth: '2026-11',
  currentMonth: '2026-11',
  currency: 'USD',
  budgets: [row('food', 10_000, 13_000, { rollover: true }), row('groceries', 20_000, 5_000), row('fun', 5_000, 4_000), row('gas', 3_000, 3_000)],
  totalLimitCents: 38_000,
  totalSpentCents: 25_000,
  yearly: [
    { categoryId: 'gifts', categoryName: 'Gifts', groupName: null, limitCents: 60_000, monthlyCents: 5_000, setAsideCents: 0, spentCents: 0, fundCents: 0, leftForYearCents: 0 },
  ],
};

describe('canEditBudgets', () => {
  it('only on this month, and only from a server that names it', () => {
    expect(canEditBudgets(data)).toBe(true);
    expect(canEditBudgets({ ...data, periodMonth: '2026-10' })).toBe(false);
    expect(canEditBudgets({ ...data, currentMonth: undefined })).toBe(false);
    // Year to date through this month is still not this month's page.
    const ytd = { range: 'ytd' as const, from: '2026-01-01', to: '2026-11-30', label: 'Year to date (Jan–Nov 2026)' };
    expect(canEditBudgets({ ...data, period: ytd })).toBe(false);
    expect(canEditBudgets({ ...data, period: { ...ytd, range: 'month' } })).toBe(true);
  });
});

describe('budgetPatch', () => {
  it('starts from the monthly budget without rollover carry, and the yearly one', () => {
    expect(budgetFormFor({ ...data, budgets: [row('food', 12_000, 0, { monthlyLimitCents: 10_000, rollover: true })] }, 'food')).toEqual({
      monthly: '100.00',
      rollover: true,
      yearly: '',
    });
    expect(budgetFormFor(data, 'gifts')).toEqual({ monthly: '', rollover: false, yearly: '600.00' });
  });

  it('sends only what changed, and an emptied field as a removal', () => {
    const initial = budgetFormFor(data, 'food');
    expect(budgetPatch(initial, { ...initial, monthly: '100' })).toEqual({ body: {}, removesMonthly: false });
    expect(budgetPatch(initial, { ...initial, monthly: '125', rollover: false, yearly: '1,200' })).toEqual({
      body: { monthlyCents: 12_500, rollover: false, yearlyCents: 120_000 },
      removesMonthly: false,
    });
    // Rollover goes with the monthly budget.
    expect(budgetPatch(initial, { ...initial, monthly: '', rollover: false })).toEqual({ body: { monthlyCents: null }, removesMonthly: true });
  });

  it('refuses zero and what is not a number', () => {
    const initial = budgetFormFor(data, 'gifts');
    expect(budgetPatch(initial, { ...initial, monthly: '0' })).toEqual({ error: 'Enter a monthly budget above zero, like 400.' });
    expect(budgetPatch(initial, { ...initial, yearly: 'lots' })).toEqual({ error: 'Enter a yearly budget above zero, like 400.' });
  });
});

describe('covering an overage', () => {
  const sources = coverSources(data, 'food');

  it('offers the other budgets with room, by name, and fills in the overage from the roomiest first', () => {
    expect(sources.map((s) => s.categoryId)).toEqual(['fun', 'groceries']);
    expect(coverPrefill(3_000, sources)).toEqual({ groceries: '30.00' });
    expect(coverPrefill(16_000, sources)).toEqual({ groceries: '150.00', fun: '10.00' });
  });

  it('adds up what is typed and refuses more than a budget has or than the overage', () => {
    expect(coverPlan(3_000, sources, { groceries: '20', fun: '10' }, 'USD')).toEqual({
      from: [
        { categoryId: 'fun', amountCents: 1_000 },
        { categoryId: 'groceries', amountCents: 2_000 },
      ],
      allocatedCents: 3_000,
      remainingCents: 0,
      error: null,
    });
    expect(coverPlan(3_000, sources, { groceries: '10' }, 'USD')).toMatchObject({ remainingCents: 2_000, error: null });
    expect(coverPlan(3_000, sources, { fun: '20' }, 'USD').error).toBe('Fun has only $10.00 to give.');
    expect(coverPlan(3_000, sources, { groceries: '40' }, 'USD').error).toBe('That is $10.00 more than the overage.');
    expect(coverPlan(3_000, sources, {}, 'USD').error).toBe('Take something from at least one budget.');
  });
});
