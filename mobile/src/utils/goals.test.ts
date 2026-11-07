import { describe, expect, it } from 'vitest';

import type { SavingsGoal } from '@/api/types';

import { canEditGoals, emptyGoalForm, formFromGoal, goalAdvice, goalBody, goalPath, goalSubtitle } from './goals';

const goal: SavingsGoal = {
  id: 'g1',
  name: 'Trip',
  targetCents: 200_000,
  targetDate: '2027-06-01',
  account: null,
  currency: 'USD',
  manualSavedCents: 50_000,
  savedCents: 50_000,
  remainingCents: 150_000,
  percent: 25,
  status: 'behind',
  monthsLeft: 7,
  monthlyNeededCents: 21_429,
  monthlyPaceCents: null,
  monthlyTransferCents: null,
  projectedDate: null,
  paceSource: null,
};

describe('savings goals', () => {
  it('is changed only on a server that says it takes goals', () => {
    const me = { user: { id: 'u', email: 'a@b.c', displayName: 'A', timezone: 'UTC', countryCode: 'US', currency: 'USD' }, device: { id: 'd' } };
    expect(canEditGoals(me)).toBe(false);
    expect(canEditGoals({ ...me, features: ['rules', 'goals'] })).toBe(true);
    expect(goalPath('g 1', 'contribute')).toBe('/api/v1/goals/g%201/contribute');
    expect(goalPath(null)).toBe('/api/v1/goals');
  });

  it('says where a goal stands and what it needs, as the website does', () => {
    expect(goalSubtitle(goal)).toBe('Tracked by hand · by Jun 1, 2027');
    expect(goalSubtitle({ ...goal, targetDate: null, account: { id: 'a', name: 'Savings', archived: true } })).toBe(
      'Follows Savings (archived) · no date',
    );
    expect(goalAdvice(goal)).toBe('Needs $214.29 a month to make Jun 1, 2027.');
    expect(
      goalAdvice({ ...goal, status: 'open', targetDate: null, paceSource: 'transfers', monthlyTransferCents: 10_000, projectedDate: '2028-03-01' }),
    ).toBe("$1,500.00 to go; you've transferred about $100.00 a month into it lately. At that rate of transfers, you'd reach it around March 2028.");
    expect(goalAdvice({ ...goal, status: 'reached' })).toBe("You've saved the full amount.");
    expect(goalAdvice({ ...goal, status: 'no-balance', account: { id: 'a', name: 'Savings', archived: false } })).toBe(
      'Savings has no balance yet. Record one on its account page.',
    );
  });

  it('sends a goal as the form has it, and asks for what is missing', () => {
    const form = formFromGoal(goal, '2026-11-07');
    expect(form).toMatchObject({ name: 'Trip', target: '2000.00', hasDate: true, date: '2027-06-01', accountId: '', saved: '500.00' });
    expect(goalBody(form)).toEqual({ body: { name: 'Trip', targetCents: 200_000, targetDate: '2027-06-01', accountId: null, savedCents: 50_000 } });
    // Following an account, no saved amount is sent; without a date, none is either.
    expect(goalBody({ ...form, accountId: 'acc', hasDate: false })).toEqual({
      body: { name: 'Trip', targetCents: 200_000, targetDate: null, accountId: 'acc' },
    });
    expect(goalBody({ ...form, saved: '0' })).toMatchObject({ body: { savedCents: 0 } });
    expect(goalBody({ ...form, name: ' ' })).toEqual({ error: 'Name the goal.' });
    expect(goalBody({ ...form, target: '-5' })).toEqual({ error: 'Enter the amount to save, like 5000.' });
    expect(emptyGoalForm('2026-11-07')).toMatchObject({ date: '2027-11-07', hasDate: false });
  });
});
