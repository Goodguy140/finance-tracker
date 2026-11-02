import type { Transaction, TransactionType } from '@/api/types';
import { formatCents } from '@/utils/money';

/** A day's entries, newest day first, as the list shows them. Rows must come newest first, as the API sends them. */
export function groupByDay(rows: readonly Transaction[]): { day: string; data: Transaction[] }[] {
  const days: { day: string; data: Transaction[] }[] = [];
  for (const row of rows) {
    const last = days.at(-1);
    if (last?.day === row.date) last.data.push(row);
    else days.push({ day: row.date, data: [row] });
  }
  return days;
}

/** The first and last day of a `YYYY-MM` month, for `from` and `to`. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

/** What a row is called: its title, or its category when it has none. */
export function transactionName(row: Pick<Transaction, 'title' | 'categoryName'>): string {
  return row.title?.trim() || row.categoryName;
}

/**
 * The amount as the list shows it: spending plain, a refund and income with a plus, a transfer
 * plain with which way it went in the subtitle. `tone` picks the colour.
 */
export function amountDisplay(row: Pick<Transaction, 'type' | 'amountCents' | 'currency'>, homeCurrency: string) {
  const currency = row.currency ?? homeCurrency;
  if (row.type === 'income') return { text: `+${formatCents(row.amountCents, currency)}`, tone: 'positive' as const };
  if (row.type === 'transfer') return { text: formatCents(Math.abs(row.amountCents), currency), tone: 'muted' as const };
  if (row.amountCents < 0) return { text: `+${formatCents(-row.amountCents, currency)}`, tone: 'positive' as const };
  return { text: formatCents(row.amountCents, currency), tone: 'plain' as const };
}

/** The line under the name: category and account, or for a transfer which accounts it moved between. */
export function transactionSubtitle(row: Transaction): string {
  if (row.type === 'transfer') {
    const from = row.amountCents >= 0 ? row.accountName : row.transferAccountName;
    const to = row.amountCents >= 0 ? row.transferAccountName : row.accountName;
    return `Transfer${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`;
  }
  const category = row.splits.length > 1 ? `Split, ${row.splits.length} categories` : row.categoryName;
  return row.accountName ? `${category} · ${row.accountName}` : category;
}

/** "12.50", "1,234.5", "$-3" → cents, or null for anything that is not an amount. A minus is kept (a refund). */
export function parseAmountInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s,$]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$|^-?\.\d{1,2}$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) && cents !== 0 ? cents : null;
}

/** Cents as the amount field shows them: 1250 → "12.50". */
export function amountInputText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "Work, trip ,work" → ["Work", "trip"]: comma-separated, trimmed, the first spelling of each kept. */
export function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim().replace(/\s+/g, ' ');
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    tags.push(name);
  }
  return tags;
}

export type EditForm = {
  title: string;
  amount: string;
  date: string;
  postedDate: string | null;
  categoryId: string;
  accountId: string | null;
  note: string;
  tags: string;
};

export function formFromTransaction(row: Transaction): EditForm {
  return {
    title: row.title ?? '',
    amount: amountInputText(row.amountCents),
    date: row.date,
    postedDate: row.postedDate,
    categoryId: row.categoryId,
    accountId: row.accountId,
    note: row.note ?? '',
    tags: row.tags.join(', '),
  };
}

/**
 * What to send to `PATCH /api/v1/transactions/:id`: only the fields the person changed, so a
 * field the phone does not edit is never touched. An error when the amount is not a number.
 */
export function changedFields(row: Transaction, form: EditForm): { body: Record<string, unknown> } | { error: string } {
  const body: Record<string, unknown> = {};
  const original = formFromTransaction(row);
  if (form.title.trim() !== original.title.trim()) body.title = form.title.trim() || null;
  if (form.note.trim() !== original.note.trim()) body.note = form.note.trim() || null;
  if (form.date !== original.date) body.date = form.date;
  if (form.postedDate !== original.postedDate) body.postedDate = form.postedDate;
  if (form.categoryId !== original.categoryId) body.categoryId = form.categoryId;
  if (form.accountId !== original.accountId) body.accountId = form.accountId;
  if (form.amount.trim() !== original.amount) {
    const cents = parseAmountInput(form.amount);
    if (cents === null) return { error: 'Enter the amount as a number, like 12.50.' };
    if (cents !== row.amountCents) body.amountCents = cents;
  }
  const tags = parseTagsInput(form.tags);
  if (tags.join('\n').toLowerCase() !== row.tags.join('\n').toLowerCase()) body.tags = tags;
  return { body };
}

/** Why the phone cannot change a field of this entry, or null when it can. */
export function lockedReason(row: Transaction, field: 'amount' | 'category' | 'account'): string | null {
  if (row.type === 'transfer') return "A transfer's amount and accounts are changed on the website.";
  if (field === 'account') return null;
  if (row.splits.length > 0) return 'This entry is split; change its amounts and categories on the website.';
  if (field === 'amount' && row.owedToYouCents > 0) return 'Someone owes you part of this; change its amount on the website.';
  if (field === 'amount' && row.creditCents) return 'This entry has credits taken off; change its amount on the website.';
  return null;
}

export type { TransactionType };
export type ListFilters = { type: TransactionType | null; needsReview: boolean };

/** Rows per page of the list. */
export const LIST_PAGE = 100;

/** The list's query: one month, or every month while searching or showing what needs review. */
export function listPath(month: string, search: string, filters: ListFilters, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(LIST_PAGE) });
  if (search) params.set('q', search);
  if (!search && !filters.needsReview) {
    const range = monthRange(month);
    params.set('from', range.from);
    params.set('to', range.to);
  }
  if (filters.type) params.set('type', filters.type);
  if (filters.needsReview) params.set('needsReview', 'true');
  if (cursor) params.set('cursor', cursor);
  return `/api/v1/transactions?${params.toString()}`;
}
