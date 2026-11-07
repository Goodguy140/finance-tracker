import { describe, expect, it } from 'vitest';

import type { QueueRow } from '@/api/types';

import { allRows, pickedRows, REVIEW_BULK_LIMIT, reviewBulkNote, sharedCategories, toggledRow } from './review-bulk';

const proposal = (title: string) => ({ title, note: null, tags: [], split: null, reason: null });

function row(id: string, type: 'expense' | 'income' = 'expense'): QueueRow {
  return {
    id,
    bank: 'Tangerine',
    heading: 'Coffee',
    bankName: 'COFFEE CO 123',
    amountCents: 450,
    direction: type === 'income' ? 'in' : 'out',
    date: '2026-11-03',
    account: 'Chequing',
    pending: false,
    isTransfer: false,
    type,
    suggestedCategoryId: null,
    asTransfer: proposal('Transfer'),
    asNonTransfer: proposal('Coffee'),
    match: null,
    transferPair: null,
  };
}

const categories = { expense: [{ id: 'food', name: 'Food' }], income: [{ id: 'pay', name: 'Pay' }] };

describe('ticking review rows', () => {
  it('ticks and unticks, never past what the server takes at once', () => {
    expect([...toggledRow(new Set(['a']), 'b')]).toEqual(['a', 'b']);
    expect([...toggledRow(new Set(['a', 'b']), 'a')]).toEqual(['b']);
    const many = Array.from({ length: REVIEW_BULK_LIMIT + 5 }, (_, i) => row(`r${i}`));
    const all = allRows(many);
    expect(all.size).toBe(REVIEW_BULK_LIMIT);
    expect(toggledRow(all, 'extra').has('extra')).toBe(false);
  });

  it('keeps only the picked rows still in the queue, in its order', () => {
    expect(pickedRows([row('a'), row('b'), row('c')], new Set(['c', 'gone', 'a'])).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('offers one category for all of them only when they are all spending or all income', () => {
    expect(sharedCategories([row('a'), row('b')], categories)).toEqual(categories.expense);
    expect(sharedCategories([row('a', 'income')], categories)).toEqual(categories.income);
    expect(sharedCategories([row('a'), row('b', 'income')], categories)).toEqual([]);
  });

  it('says what it did', () => {
    expect(reviewBulkNote('add', 3)).toBe('Added 3 transactions.');
    expect(reviewBulkNote('add', 1, 'Food')).toBe('Added 1 transaction to Food.');
    expect(reviewBulkNote('ignore', 2)).toBe('Ignored 2 rows.');
  });
});
