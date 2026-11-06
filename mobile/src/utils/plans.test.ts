import { describe, expect, it } from 'vitest';

import type { Plan } from '@/api/types';
import { emptyPlanForm, formFromPlan, groupPlans, planBody, planPath } from './plans';

const plan = (overrides: Partial<Plan> = {}): Plan => ({
  id: 'p1',
  type: 'expense',
  name: 'Brakes',
  amountCents: 60_000,
  currency: 'CAD',
  date: '2026-11-20',
  accountId: 'chq',
  accountName: 'Chequing',
  categoryId: 'car',
  categoryName: 'Car',
  note: null,
  pastDue: false,
  ...overrides,
});

describe('planBody', () => {
  it('sends a positive amount in cents with the account and category', () => {
    expect(planBody({ ...formFromPlan(plan()), note: '  ' })).toEqual({
      body: { type: 'expense', name: 'Brakes', amountCents: 60_000, date: '2026-11-20', accountId: 'chq', categoryId: 'car', note: null },
    });
  });

  it('asks for what is missing, as the website does', () => {
    const form = emptyPlanForm('2026-11-06', 'chq');
    expect(planBody(form)).toEqual({ error: 'Name what you are planning for.' });
    expect(planBody({ ...form, name: 'Tires', amount: '-5' })).toEqual({ error: 'Enter a positive amount, like 600.' });
    expect(planBody({ ...form, name: 'Tires', amount: '500' })).toEqual({ error: 'Choose a category.' });
  });
});

describe('groupPlans', () => {
  it('puts plans past their date first, to ask whether they happened', () => {
    const groups = groupPlans([plan({ id: 'a' }), plan({ id: 'b', pastDue: true })]);
    expect(groups.map((g) => [g.title, g.plans.map((p) => p.id)])).toEqual([
      ['Did this happen?', ['b']],
      ['One-off plans', ['a']],
    ]);
    expect(planPath('p 1', 'record')).toBe('/api/v1/planned/p%201/record');
  });
});
