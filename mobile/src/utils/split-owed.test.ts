import { describe, expect, it } from 'vitest';

import type { OwedShare, Transaction } from '@/api/types';
import { ownPartNote, parseOwedLines, splitRemainderNote, type OwedLine, type SplitLine } from './split-owed';
import { changedFields, formFromTransaction, lockedReason } from './transactions';

function tx(overrides: Partial<Transaction & { owedShares: OwedShare[] }> = {}): Transaction & { owedShares?: OwedShare[] } {
  return {
    id: 't1',
    type: 'expense',
    date: '2026-11-05',
    postedDate: null,
    title: 'Dinner',
    amountCents: 9_000,
    currency: 'USD',
    categoryId: 'food',
    categoryName: 'Food',
    accountId: 'visa',
    accountName: 'Visa',
    transferAccountId: null,
    note: null,
    tags: [],
    splits: [],
    owedToYouCents: 0,
    verified: false,
    owedShares: [],
    ...overrides,
  };
}

const line = (categoryId: string, amount: string, key = categoryId): SplitLine => ({ key, categoryId, amount });
const owed = (name: string, amount: string, id: string | null = null): OwedLine => ({ key: name, id, name, amount, paid: false });

describe('splitting an expense', () => {
  it('sends every line, adding up to the amount, and never a category beside them', () => {
    const row = tx();
    const form = { ...formFromTransaction(row), categoryId: 'other', splits: [line('food', '60'), line('drinks', '30')] };
    expect(changedFields(row, form)).toEqual({
      body: { splits: [{ categoryId: 'food', amountCents: 6_000 }, { categoryId: 'drinks', amountCents: 3_000 }] },
    });
    // The amount never moves on its own: lines that miss it are refused, a new amount goes with them.
    expect(changedFields(row, { ...form, splits: [line('food', '60'), line('drinks', '40')] })).toEqual({
      error: 'The lines add up to $100.00, but the amount is $90.00. Make them match.',
    });
    expect(changedFields(row, { ...form, amount: '100', splits: [line('food', '60'), line('drinks', '40')] })).toEqual({
      body: { splits: [{ categoryId: 'food', amountCents: 6_000 }, { categoryId: 'drinks', amountCents: 4_000 }], amountCents: 10_000 },
    });
    expect(changedFields(row, { ...form, splits: [line('food', '90')] })).toHaveProperty('error');
    expect(changedFields(row, { ...form, splits: [line('', '60'), line('drinks', '30')] })).toEqual({ error: 'Pick a category for each split line.' });
  });

  it('books a split whole again in the category picked once the split is removed', () => {
    const row = tx({ splits: [{ categoryId: 'food', amountCents: 6_000 }, { categoryId: 'drinks', amountCents: 3_000 }] });
    const unchanged = formFromTransaction(row);
    expect(changedFields(row, unchanged)).toEqual({ body: {} });
    expect(changedFields(row, { ...unchanged, splits: [], categoryId: 'food' })).toEqual({
      body: { splits: [{ categoryId: 'food', amountCents: 9_000 }] },
    });
  });


  it('says what is left to split', () => {
    expect(splitRemainderNote(9_000, [line('a', '60'), line('b', '20')], 'USD')).toBe('$10.00 left to split.');
    expect(splitRemainderNote(9_000, [line('a', '60'), line('b', '30')], 'USD')).toBeNull();
    expect(splitRemainderNote(9_000, [line('a', '60'), line('b', '')], 'USD')).toBeNull();
  });
});

describe('who owes part of it back', () => {
  it('shows and sends what was paid, the shares coming out of it', () => {
    const row = tx({ amountCents: 3_000, owedToYouCents: 6_000, owedShares: [{ id: 's1', name: 'Sam', amountCents: 6_000, paidAt: null }] });
    const form = formFromTransaction(row);
    expect(form.amount).toBe('90.00');
    expect(changedFields(row, form)).toEqual({ body: {} });
    expect(changedFields(row, { ...form, amount: '120' })).toEqual({
      body: { owedShares: [{ id: 's1', name: 'Sam', amountCents: 6_000 }], paidCents: 12_000 },
    });
    expect(changedFields(row, { ...form, owed: [] })).toEqual({ body: { owedShares: [] } });
  });

  it('adds new shares without an id and drops blank rows', () => {
    const row = tx();
    const form = { ...formFromTransaction(row), owed: [owed('Alex', '30'), owed('', '')] };
    expect(changedFields(row, form)).toEqual({ body: { owedShares: [{ id: null, name: 'Alex', amountCents: 3_000 }] } });
    expect(changedFields(row, { ...form, owed: [owed('Alex', '-3')] })).toEqual({ error: 'Enter a positive amount owed by Alex.' });
    expect(changedFields(tx({ amountCents: -500 }), { ...formFromTransaction(tx({ amountCents: -500 })), owed: [owed('Alex', '3')] })).toEqual({
      error: 'Only a purchase can be owed back, not a refund.',
    });
  });

  it('works out the person’s own part', () => {
    expect(ownPartNote(9_000, [owed('Sam', '60')], 'USD')).toBe('Your part: $30.00. Only your part counts as spending.');
    expect(ownPartNote(9_000, [owed('Sam', '100')], 'USD')).toBe('What others owe adds up to more than you paid.');
    expect(parseOwedLines([owed('', '5')])).toEqual({ error: 'Say who owes each amount.' });
  });

  it('unlocks the amount only on a server that edits shares', () => {
    expect(lockedReason(tx({ owedToYouCents: 500 }), 'amount')).toBeNull();
    const old = tx({ owedToYouCents: 500 });
    delete old.owedShares;
    expect(lockedReason(old, 'amount')).toMatch(/owes you/);
    expect(changedFields(old, { ...formFromTransaction(old), owed: [owed('Sam', '5')] })).toEqual({ body: {} });
  });
});
