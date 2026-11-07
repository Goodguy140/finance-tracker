import { describe, expect, it } from 'vitest';

import type { SavedSearch } from '@/api/types';

import { applySavedSearch, filtersLine, isSearching, NO_SEARCH_FILTERS, savedSearchShown, searchPath, totalsLine } from './search';

function saved(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 's1',
    name: 'Coffee',
    q: 'coffee',
    type: 'expense',
    accountId: null,
    categoryId: 'food',
    tagId: null,
    count: 3,
    spentCents: 1_200,
    receivedCents: 0,
    summary: '3 transactions · Spent $12.00',
    ...overrides,
  };
}

describe('search', () => {
  it('looks across every month for words or any of its own filters, and sends them all', () => {
    expect(isSearching('', NO_SEARCH_FILTERS)).toBe(false);
    expect(isSearching('', { ...NO_SEARCH_FILTERS, tagId: 't1' })).toBe(true);
    expect(searchPath('tim hortons', { type: 'expense', needsReview: true }, { accountId: 'a1', categoryId: 'c1', tagId: 't1' }, 'c9')).toBe(
      '/api/v1/search?limit=100&q=tim+hortons&type=expense&accountId=a1&categoryId=c1&tagId=t1&needsReview=true&cursor=c9',
    );
    expect(searchPath('', { type: null, needsReview: false }, { ...NO_SEARCH_FILTERS, accountId: 'a1' }, null)).toBe(
      '/api/v1/search?limit=100&accountId=a1',
    );
  });

  it('words the totals as the website does, leaving out what is zero', () => {
    expect(totalsLine({ count: 1, spentCents: 450, receivedCents: 0 }, 'USD')).toBe('1 transaction · Spent $4.50');
    expect(totalsLine({ count: 3, spentCents: 0, receivedCents: 200_000 }, 'USD')).toBe('3 transactions · Received $2,000.00');
    expect(totalsLine({ count: 0, spentCents: 0, receivedCents: 0 }, 'USD')).toBe('0 transactions');
  });

  it('puts a saved search back on screen, and knows it again only when nothing differs', () => {
    const coffee = saved();
    const shown = applySavedSearch(coffee);
    expect(shown).toEqual({ text: 'coffee', type: 'expense', more: { accountId: null, categoryId: 'food', tagId: null } });
    const filters = { type: shown.type, needsReview: false };
    expect(savedSearchShown([coffee], 'Coffee', filters, shown.more)).toBe(coffee);
    expect(savedSearchShown([coffee], 'coffee', { ...filters, type: null }, shown.more)).toBeNull();
    expect(savedSearchShown([coffee], 'coffee', filters, { ...shown.more, tagId: 't1' })).toBeNull();
    // Needs review is never part of a saved search.
    expect(savedSearchShown([coffee], 'coffee', { ...filters, needsReview: true }, shown.more)).toBeNull();
  });

  it('names the filters on screen', () => {
    expect(
      filtersLine({ type: 'expense', needsReview: true }, { accountId: 'a', categoryId: 'c', tagId: 't' }, { account: 'Chequing', category: 'Food', tag: 'trip' }, 'Spending'),
    ).toBe('Needs review · Spending · on Chequing · in Food · #trip');
    expect(filtersLine({ type: null, needsReview: false }, NO_SEARCH_FILTERS, {}, undefined)).toBe('');
  });
});
