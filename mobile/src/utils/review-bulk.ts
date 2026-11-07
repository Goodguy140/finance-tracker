import type { QueueRow, ReviewQueue } from '@/api/types';

/** Ticking rows on the Review tab, as the website's queue does: add them, add them in one category, or ignore them. */

/** The server's most rows in one bulk step. */
export const REVIEW_BULK_LIMIT = 200;

export function toggledRow(picked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else if (next.size < REVIEW_BULK_LIMIT) next.add(id);
  return next;
}

export function allRows(rows: readonly Pick<QueueRow, 'id'>[]): Set<string> {
  return new Set(rows.slice(0, REVIEW_BULK_LIMIT).map((row) => row.id));
}

/** The picked rows still in the queue, in its order: one decided elsewhere drops out. */
export function pickedRows(rows: readonly QueueRow[], picked: ReadonlySet<string>): QueueRow[] {
  return rows.filter((row) => picked.has(row.id));
}

/**
 * The categories one pick can all go in: only when every row is spending, or every row income,
 * as the website offers it; none otherwise.
 */
export function sharedCategories(rows: readonly QueueRow[], categories: ReviewQueue['categories']): { id: string; name: string }[] {
  const kinds = new Set(rows.map((row) => row.type));
  if (kinds.size !== 1) return [];
  return categories[rows[0].type];
}

export function rowsLabel(n: number): string {
  return n === 1 ? '1 row' : `${n} rows`;
}

/** What a bulk step did, in a line. */
export function reviewBulkNote(action: 'add' | 'ignore', count: number, categoryName?: string): string {
  const what = count === 1 ? '1 transaction' : `${count} transactions`;
  if (action === 'ignore') return `Ignored ${rowsLabel(count)}.`;
  return categoryName ? `Added ${what} to ${categoryName}.` : `Added ${what}.`;
}
