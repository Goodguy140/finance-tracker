import type { Transaction } from '@/api/types';

/** Select in Transactions: one change to several expenses, as the website's Expense Log makes it. */

export const BULK_PATH = '/api/v1/transactions/bulk';
export const BULK_LIMIT = 500;

export type BulkOp = 'category' | 'account' | 'tag' | 'reviewed' | 'delete';
export type BulkResult = { changed: number; skipped: number; undoIds: string[] };

/** Only spending can be picked, as on the website; income and transfers have their own lists there. */
export function selectable(row: Pick<Transaction, 'type'>): boolean {
  return row.type === 'expense';
}

export function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else if (next.size < BULK_LIMIT) next.add(id);
  return next;
}

/** Every expense shown, up to the limit. */
export function selectAll(rows: readonly Pick<Transaction, 'id' | 'type'>[]): Set<string> {
  return new Set(rows.filter(selectable).slice(0, BULK_LIMIT).map((row) => row.id));
}

function expenses(n: number): string {
  return n === 1 ? '1 expense' : `${n} expenses`;
}

/** What the change did, in a line: "Moved 3 expenses to Food. 1 split expense kept its categories." */
export function bulkNote(op: BulkOp, result: BulkResult, name?: string): string {
  const n = result.changed;
  const main =
    op === 'category'
      ? `Moved ${expenses(n)} to ${name ?? 'the category'}.`
      : op === 'account'
        ? `Moved ${expenses(n)} to ${name ?? 'the account'}.`
        : op === 'tag'
          ? `Tagged ${expenses(n)} #${name ?? ''}.`
          : op === 'reviewed'
            ? `Marked ${expenses(n)} reviewed.`
            : `Deleted ${expenses(n)}.`;
  if (!result.skipped) return main;
  return `${main} ${result.skipped === 1 ? '1 split expense kept its' : `${result.skipped} split expenses kept their`} categories.`;
}
