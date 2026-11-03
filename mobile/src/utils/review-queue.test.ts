import { describe, expect, it } from 'vitest';

import type { QueueRow } from '@/api/types';
import {
  acceptRequest,
  addBody,
  banksNeedingAttention,
  defaultDecision,
  ignoreRequest,
  proposalFor,
  queueAmount,
  queueBadge,
  queueCategory,
  queueSubtitle,
  strongLinks,
  transferDirection,
  unmatchedIds,
} from './review-queue';

const proposal = (title: string) => ({ title, note: null, tags: [], split: null, reason: null });

function row(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: 's1',
    bank: 'Tangerine',
    heading: 'Coffee',
    bankName: 'COFFEE CO 123',
    amountCents: 450,
    direction: 'out',
    date: '2026-11-03',
    account: 'Chequing',
    pending: false,
    isTransfer: false,
    type: 'expense',
    suggestedCategoryId: 'food',
    asTransfer: proposal('Transfer'),
    asNonTransfer: proposal('Coffee'),
    match: null,
    transferPair: null,
    ...overrides,
  };
}

const match = (transactionId: string, tier: 'high' | 'low') => ({
  transaction: { id: transactionId, title: 'Coffee', amountCents: 450, date: '2026-11-03' },
  tier,
  reasons: [],
});
const pair = { id: 's9', heading: 'Transfer', account: 'Savings', date: '2026-11-03', outflow: true };

describe('the queue proposes what the website does', () => {
  it('links a strong match, pairs a transfer over a weak match, and otherwise adds', () => {
    expect(defaultDecision(row({ match: match('t1', 'high'), transferPair: pair }))).toBe('link');
    expect(defaultDecision(row({ match: match('t1', 'low'), transferPair: pair }))).toBe('pair');
    expect(defaultDecision(row({ match: match('t1', 'low') }))).toBe('add');
  });

  it('leaves matches and pairs out of Add all', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', match: match('t1', 'low') }), row({ id: 'c', transferPair: pair })];
    expect(unmatchedIds(rows)).toEqual(['a']);
  });

  it('links only strong matches whose entry no other row claims', () => {
    const rows = [
      row({ id: 'a', match: match('t1', 'high') }),
      row({ id: 'b', match: match('t2', 'high') }),
      row({ id: 'c', match: match('t2', 'high') }),
      row({ id: 'd', match: match('t3', 'low') }),
    ];
    expect(strongLinks(rows)).toEqual([{ id: 'a', transactionId: 't1' }]);
  });
});

it('shows money in with a plus and never a bare minus', () => {
  expect(queueAmount({ amountCents: -1250, direction: 'in' }, 'USD')).toEqual({ text: '+$12.50', moneyIn: true });
  expect(queueAmount({ amountCents: 1250, direction: 'out' }, 'USD')).toEqual({ text: '$12.50', moneyIn: false });
});

it('previews what each choice writes, and nothing for a link', () => {
  const r = row();
  expect(proposalFor(r, 'link', false)).toBeNull();
  expect(proposalFor(r, 'pair', false)?.title).toBe('Transfer');
  expect(proposalFor(r, 'add', true)?.title).toBe('Transfer');
  expect(proposalFor(r, 'add', false)?.title).toBe('Coffee');
});

it('names the bank text only when a rule renamed the row', () => {
  expect(queueSubtitle(row({ pending: true }), 'en-US')).toBe('COFFEE CO 123 · Chequing · Tue, Nov 3 · Pending');
  expect(queueSubtitle(row({ bankName: 'Coffee' }), 'en-US')).toBe('Chequing · Tue, Nov 3');
});

it('says which way a paired transfer went', () => {
  expect(transferDirection(row({ transferPair: pair }))).toBe('Chequing → Savings');
  expect(transferDirection(row({ transferPair: { ...pair, outflow: false } }))).toBe('Savings → Chequing');
});

it('adds as a transfer without a category, and otherwise as its own type in the chosen one', () => {
  expect(addBody(row(), true, 'food')).toEqual({ decision: 'add', countAs: 'transfer' });
  expect(addBody(row({ type: 'income' }), false, 'pay')).toEqual({ decision: 'add', countAs: 'income', categoryId: 'pay' });
});

it('badges the tab only when something waits', () => {
  expect(queueBadge(0)).toBeUndefined();
  expect(queueBadge(7)).toBe('7');
  expect(queueBadge(240)).toBe('99+');
});

it('lists only banks that need something', () => {
  const banks = [
    { id: 'b1', name: 'Tangerine', lastSyncedAt: null, attention: null },
    { id: 'b2', name: 'RBC', lastSyncedAt: null, attention: { kind: 'reauth', message: 'Sign in', actionLabel: 'Sign in again' } },
  ];
  expect(banksNeedingAttention(banks)).toEqual([{ id: 'b2', name: 'RBC', kind: 'reauth', message: 'Sign in', actionLabel: 'Sign in again' }]);
});

describe('the list row', () => {
  const categories = {
    expense: [
      { id: 'food', name: 'Groceries' },
      { id: 'fun', name: 'Fun' },
    ],
    income: [{ id: 'pay', name: 'Salary' }],
  };

  it('shows the category the row is added in, of its own type', () => {
    expect(queueCategory(row(), categories)).toBe('Groceries');
    expect(queueCategory(row({ type: 'income', suggestedCategoryId: 'pay', direction: 'in' }), categories)).toBe('Salary');
    expect(queueCategory(row({ suggestedCategoryId: 'gone' }), categories)).toBeNull();
  });

  it('shows Transfer for a transfer or a pair, and nothing for a link, which keeps its entry', () => {
    expect(queueCategory(row({ isTransfer: true }), categories)).toBe('Transfer');
    expect(queueCategory(row({ transferPair: pair }), categories)).toBe('Transfer');
    expect(queueCategory(row({ match: match('t1', 'high') }), categories)).toBeNull();
    expect(queueCategory(row({ match: match('t1', 'low') }), categories)).toBe('Groceries');
  });

  it('accepts a swiped row as proposed: adds in its category, or as a transfer', () => {
    expect(acceptRequest(row())).toEqual({
      label: 'Add',
      path: '/api/v1/review-queue/s1',
      body: { decision: 'add', countAs: 'expense', categoryId: 'food' },
    });
    expect(acceptRequest(row({ isTransfer: true })).body).toEqual({ decision: 'add', countAs: 'transfer' });
  });

  it('links a strong match and pairs a transfer instead of adding a duplicate', () => {
    expect(acceptRequest(row({ match: match('t1', 'high') }))).toEqual({
      label: 'Link',
      path: '/api/v1/review-queue/s1',
      body: { decision: 'link', transactionId: 't1' },
    });
    expect(acceptRequest(row({ transferPair: pair }))).toEqual({
      label: 'Pair',
      path: '/api/v1/review-queue/pair',
      body: { id: 's1', peerId: 's9' },
    });
  });

  it('ignores a row swiped the other way', () => {
    expect(ignoreRequest(row({ id: 'a/b' }))).toEqual({
      label: 'Ignore',
      path: '/api/v1/review-queue/a%2Fb',
      body: { decision: 'ignore' },
    });
  });
});
