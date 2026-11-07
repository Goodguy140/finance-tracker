import { describe, expect, it } from 'vitest';

import { BULK_LIMIT, bulkNote, selectAll, selectable, toggled } from './bulk-edit';

describe('picking', () => {
  it('picks only spending, and toggles a row in and out', () => {
    expect(selectable({ type: 'expense' })).toBe(true);
    expect(selectable({ type: 'income' })).toBe(false);
    const rows = [
      { id: 'a', type: 'expense' as const },
      { id: 'b', type: 'income' as const },
      { id: 'c', type: 'expense' as const },
    ];
    expect([...selectAll(rows)]).toEqual(['a', 'c']);
    expect([...toggled(new Set(['a']), 'a')]).toEqual([]);
    expect([...toggled(new Set(['a']), 'c')]).toEqual(['a', 'c']);
  });

  it('stops at the server’s limit', () => {
    const full = new Set(Array.from({ length: BULK_LIMIT }, (_, i) => `t${i}`));
    expect(toggled(full, 'one-more').size).toBe(BULK_LIMIT);
  });
});

describe('bulkNote', () => {
  it('says what changed, and what a split kept', () => {
    expect(bulkNote('category', { changed: 3, skipped: 1, undoIds: [] }, 'Food')).toBe('Moved 3 expenses to Food. 1 split expense kept its categories.');
    expect(bulkNote('tag', { changed: 1, skipped: 0, undoIds: [] }, 'trip')).toBe('Tagged 1 expense #trip.');
    expect(bulkNote('reviewed', { changed: 2, skipped: 0, undoIds: [] })).toBe('Marked 2 expenses reviewed.');
    expect(bulkNote('category', { changed: 0, skipped: 2, undoIds: [] }, 'Fun')).toBe('Moved 0 expenses to Fun. 2 split expenses kept their categories.');
  });
});
