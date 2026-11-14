import { describe, expect, it } from 'vitest';

import type { BudgetSuggestionSet, CategoryDetail } from '@/api/types';
import {
  canEditCategories,
  categoryForm,
  categoryPatch,
  categorySections,
  incomeLine,
  initialPicks,
  monthsLine,
  moveTargets,
  newCategoryBody,
  pickedBudgets,
  sameNameCategory,
  sameNameTag,
  tidyTagName,
  totalAfter,
  usesLine,
} from './category-edits';

const cat = (id: string, name: string, over: Partial<CategoryDetail> = {}): CategoryDetail => ({
  id,
  name,
  kind: 'expense',
  groupName: null,
  spendingRole: null,
  uses: 0,
  ...over,
});

const categories = [
  cat('g', 'Groceries', { groupName: 'Food', uses: 12 }),
  cat('d', 'Dining', { groupName: 'Food', spendingRole: 'want' }),
  cat('x', 'Gas'),
  cat('p', 'Pay', { kind: 'income' }),
  cat('t', 'Transfer', { kind: 'transfer' }),
];

describe('canEditCategories', () => {
  it('waits for a server that takes category edits', () => {
    expect(canEditCategories({ features: ['category-edits'] })).toBe(true);
    expect(canEditCategories({ features: [] })).toBe(false);
    expect(canEditCategories(undefined)).toBe(false);
  });
});

describe('the list', () => {
  it('puts spending under its groups, then the ungrouped, then income, leaving the transfer category out', () => {
    expect(categorySections(categories).map((s) => [s.title, s.items.map((c) => c.name)])).toEqual([
      ['Spending · Food', ['Dining', 'Groceries']],
      ['Spending · No group', ['Gas']],
      ['Income', ['Pay']],
    ]);
    expect(categorySections([cat('x', 'Gas')]).map((s) => s.title)).toEqual(['Spending']);
    expect(usesLine(0)).toBe('Not used yet');
    expect(usesLine(1)).toBe('Used 1 time');
    expect(usesLine(12)).toBe('Used 12 times');
  });

  it('finds a same-named category of the kind, and where a deleted one can move to', () => {
    expect(sameNameCategory(categories, 'expense', '  dining ')?.id).toBe('d');
    expect(sameNameCategory(categories, 'income', 'dining')).toBeUndefined();
    expect(sameNameCategory(categories, 'expense', 'Dining', 'd')).toBeUndefined();
    expect(moveTargets(categories, categories[0]).map((c) => c.name)).toEqual(['Dining', 'Gas']);
  });
});

describe('newCategoryBody', () => {
  it('sends a budget only for spending, and refuses a name already used', () => {
    expect(newCategoryBody({ name: ' Pets  and vet ', kind: 'expense', limit: '60' }, categories)).toEqual({
      body: { name: 'Pets and vet', kind: 'expense', limitCents: 6_000 },
    });
    expect(newCategoryBody({ name: 'Bonus', kind: 'income', limit: '60' }, categories)).toEqual({ body: { name: 'Bonus', kind: 'income' } });
    expect(newCategoryBody({ name: 'gas', kind: 'expense', limit: '' }, categories)).toEqual({ error: 'You already have a category called “gas”.' });
    expect(newCategoryBody({ name: '  ', kind: 'expense', limit: '' }, categories)).toEqual({ error: 'Enter a name for the category.' });
    expect(newCategoryBody({ name: 'Fun', kind: 'expense', limit: '-5' }, categories)).toEqual({ error: 'Enter a monthly limit above zero.' });
  });
});

describe('categoryPatch', () => {
  it('sends only what changed, a cleared group as null, and need or want only for spending', () => {
    const dining = categories[1];
    const form = categoryForm(dining);
    expect(form).toEqual({ name: 'Dining', groupName: 'Food', spendingRole: 'want' });
    expect(categoryPatch(form, dining)).toBeNull();
    expect(categoryPatch({ ...form, name: 'Eating out', groupName: '', spendingRole: 'auto' }, dining)).toEqual({
      body: { name: 'Eating out', groupName: null, spendingRole: null },
    });
    const pay = categories[3];
    expect(categoryPatch({ ...categoryForm(pay), spendingRole: 'need', groupName: 'Work' }, pay)).toEqual({ body: { groupName: 'Work' } });
    expect(categoryPatch({ ...form, name: '' }, dining)).toEqual({ error: 'Enter a name for the category.' });
  });
});

describe('Suggest budgets', () => {
  const set: BudgetSuggestionSet = {
    window: 3,
    months: [
      { month: '2026-08', label: 'Aug' },
      { month: '2026-09', label: 'Sep' },
      { month: '2026-10', label: 'Oct' },
    ],
    span: 'Aug 2026 to Oct 2026',
    averageIncomeCents: 300_000,
    rows: [
      { categoryId: 'g', categoryName: 'Groceries', suggestedCents: 45_000, monthlyCents: [42_000, 120_000, 38_000], spikeMonths: ['2026-09'], currentLimitCents: null },
      { categoryId: 'x', categoryName: 'Gas', suggestedCents: 15_000, monthlyCents: [14_000, 13_000, 15_000], spikeMonths: [], currentLimitCents: 20_000 },
    ],
  };

  it('ticks the unbudgeted ones, sets the ticked amounts, and totals them with the budgets already in force', () => {
    const picks = initialPicks(set);
    expect(picks).toEqual({ g: { ticked: true, amount: '450' }, x: { ticked: false, amount: '150' } });
    const picked = pickedBudgets(set, picks);
    expect(picked).toEqual({ budgets: [{ categoryId: 'g', limitCents: 45_000 }] });
    expect(pickedBudgets(set, { ...picks, x: { ticked: true, amount: 'abc' } })).toEqual({ error: 'Enter a monthly amount above zero for Gas.' });
    const current = [
      { categoryId: 'x', limitCents: 20_000 },
      { categoryId: 'r', limitCents: 150_000 },
    ];
    expect(totalAfter(current, 'budgets' in picked ? picked.budgets : [])).toBe(215_000);
    expect(totalAfter(current, [{ categoryId: 'x', limitCents: 15_000 }])).toBe(165_000);
  });

  it('words the months with the one-off passed over, and the total against income', () => {
    expect(monthsLine(set.rows[0], set.months, 'USD')).toBe('Aug $420.00 · Sep $1,200.00 (one-off, passed over) · Oct $380.00');
    expect(incomeLine(300_000, 215_000, 'USD')).toBe('Average income $3,000.00 a month, leaving $850.00.');
    expect(incomeLine(300_000, 310_000, 'USD')).toBe('Average income $3,000.00 a month, $100.00 more than comes in.');
    expect(incomeLine(0, 1_000, 'USD')).toBeNull();
  });
});

describe('tags', () => {
  it('tidies a name as the server does and finds the tag a rename would merge into', () => {
    const tags = [
      { id: 'a', name: 'Trip', count: 3 },
      { id: 'b', name: 'Work', count: 1 },
    ];
    expect(tidyTagName('  #road,  trip ')).toBe('road trip');
    expect(sameNameTag(tags, '#trip', 'b')?.id).toBe('a');
    expect(sameNameTag(tags, 'Trip', 'a')).toBeUndefined();
  });
});
