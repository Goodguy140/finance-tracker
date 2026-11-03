import { describe, expect, it } from 'vitest';

import type { RecurringRule } from '@/api/types';

import { groupRecurring, postRequest, recurringSubtitle, skipRequest } from './recurring';

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'r1',
    name: 'Rent',
    type: 'expense',
    amountCents: 150_000,
    currency: 'CAD',
    cadence: 'monthly',
    date: '2026-11-10',
    status: 'upcoming',
    account: 'Chequing',
    toAccount: null,
    category: 'Housing',
    autoPost: false,
    endDate: null,
    ...overrides,
  };
}

describe('recurringSubtitle', () => {
  it('names how often, the account and the category', () => {
    expect(recurringSubtitle(rule())).toBe('Monthly · Chequing · Housing');
    expect(recurringSubtitle(rule({ cadence: 'semi_monthly', category: null }))).toBe('Twice a month · Chequing');
  });

  it('shows where a transfer goes', () => {
    expect(recurringSubtitle(rule({ type: 'transfer', toAccount: 'Savings', category: null }))).toBe('Monthly · Chequing → Savings');
  });
});

describe('groupRecurring', () => {
  it('puts each rule under overdue, today, the next 7 days or later, leaving out empty groups', () => {
    const groups = groupRecurring(
      [
        rule({ id: 'a', status: 'overdue', date: '2026-11-01' }),
        rule({ id: 'b', status: 'due', date: '2026-11-03' }),
        rule({ id: 'c', date: '2026-11-10' }),
        rule({ id: 'd', date: '2026-11-11' }),
      ],
      '2026-11-03',
    );
    expect(groups.map((g) => [g.title, g.rules.map((r) => r.id)])).toEqual([
      ['Overdue', ['a']],
      ['Today', ['b']],
      ['Next 7 days', ['c']],
      ['Later', ['d']],
    ]);
  });
});

it('posts and skips the occurrence the list showed, escaping the id', () => {
  expect(postRequest({ id: 'a/b', date: '2026-11-10' })).toEqual({
    path: '/api/v1/recurring/a%2Fb/post',
    body: { expectedDate: '2026-11-10' },
  });
  expect(skipRequest({ id: 'r1', date: '2026-11-10' }, 'already_logged')).toEqual({
    path: '/api/v1/recurring/r1/skip',
    body: { expectedDate: '2026-11-10', reason: 'already_logged' },
  });
});
