import type { LinkedBank, QueueProposal, QueueRow, ReviewQueue } from '@/api/types';
import { formatDay } from '@/utils/dates';
import { formatCents } from '@/utils/money';

/**
 * The bank review queue on the phone. The server decides what each row would write
 * (`GET /api/v1/review-queue`, the same rows the website's queue shows); these pick between
 * them the way the website's queue does.
 */

export const REVIEW_QUEUE_PATH = '/api/v1/review-queue';

export type QueueDecision = 'link' | 'pair' | 'add';

/**
 * What the queue proposes first: a strong match is linked; otherwise a transfer pair is paired,
 * since two bank rows agreeing to the cent on opposite sides beat an entry that only roughly
 * fits; otherwise the row is added.
 */
export function defaultDecision(row: Pick<QueueRow, 'match' | 'transferPair'>): QueueDecision {
  return row.match?.tier === 'high' ? 'link' : row.transferPair ? 'pair' : 'add';
}

/** "Add all": rows with nothing to link or pair. Adding one side of a pair alone would lose the pair. */
export function unmatchedIds(rows: readonly QueueRow[]): string[] {
  return rows.filter((row) => !row.match && !row.transferPair).map((row) => row.id);
}

/** "Link all strong matches": each strong match whose entry no other row also claims. */
export function strongLinks(rows: readonly QueueRow[]): { id: string; transactionId: string }[] {
  const strong = rows.filter((row) => row.match?.tier === 'high');
  const claims = new Map<string, number>();
  for (const row of strong) claims.set(row.match!.transaction.id, (claims.get(row.match!.transaction.id) ?? 0) + 1);
  return strong
    .filter((row) => claims.get(row.match!.transaction.id) === 1)
    .map((row) => ({ id: row.id, transactionId: row.match!.transaction.id }));
}

/** The amount as the website's queue shows it: money in gets a plus, never a bare minus. */
export function queueAmount(row: Pick<QueueRow, 'amountCents' | 'direction'>, currency: string): { text: string; moneyIn: boolean } {
  const moneyIn = row.direction === 'in';
  return { text: `${moneyIn ? '+' : ''}${formatCents(Math.abs(row.amountCents), currency)}`, moneyIn };
}

/** What a decision would write. Null for a link: it keeps the entry the person already made. */
export function proposalFor(row: QueueRow, decision: QueueDecision, asTransfer: boolean): QueueProposal | null {
  if (decision === 'link') return null;
  if (decision === 'pair') return row.asTransfer;
  return asTransfer ? row.asTransfer : row.asNonTransfer;
}

/** Why the title or category differ from the bank's own. */
export function proposalReason(proposal: QueueProposal): string | null {
  if (proposal.reason === 'rule') return 'Filled in by your rules';
  if (proposal.reason === 'learned') return 'Category from a past entry';
  return null;
}

/**
 * The line under a row's name: the bank's own name when a rule renamed it, the account, the day.
 * Whether it is a transfer shows where its category does (`queueCategory`).
 */
export function queueSubtitle(row: QueueRow, locale?: string): string {
  const title = row.isTransfer ? row.asTransfer.title : row.asNonTransfer.title;
  return [
    title !== row.bankName ? row.bankName : null,
    row.account,
    formatDay(row.date, locale),
    row.pending ? 'Pending' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Chequing → Savings", the way the money went between a row and its pair. */
export function transferDirection(row: QueueRow): string | null {
  const pair = row.transferPair;
  if (!pair) return null;
  return pair.outflow ? `${row.account} → ${pair.account}` : `${pair.account} → ${row.account}`;
}

/** The body `POST /api/v1/review-queue/:id` takes to add a row as a transfer, or in a category. */
export function addBody(row: Pick<QueueRow, 'type'>, asTransfer: boolean, categoryId: string | null) {
  if (asTransfer) return { decision: 'add' as const, countAs: 'transfer' as const };
  return { decision: 'add' as const, countAs: row.type, ...(categoryId ? { categoryId } : {}) };
}

/** The Review tab's badge: nothing at zero, and no wider than "99+". */
export function queueBadge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

/** Banks that need the person (signing in again, renewing access, new accounts). */
export function banksNeedingAttention(banks: readonly LinkedBank[]) {
  return banks.flatMap((bank) => (bank.attention ? [{ id: bank.id, name: bank.name, ...bank.attention }] : []));
}

/**
 * The category the row goes in if it is accepted as proposed (what the website's queue preselects):
 * "Transfer" for a transfer or a pair, and nothing for a link, which keeps the entry's own.
 */
export function queueCategory(row: QueueRow, categories: ReviewQueue['categories']): string | null {
  const decision = defaultDecision(row);
  if (decision === 'link') return null;
  if (decision === 'pair' || row.isTransfer) return 'Transfer';
  return categories[row.type].find((category) => category.id === row.suggestedCategoryId)?.name ?? null;
}

export type QueueRequest = { label: string; path: string; body: Record<string, unknown> };

/**
 * Swiping a row right accepts what the queue proposes, as the row would be saved without changing
 * anything on it: link a strong match, pair a transfer, otherwise add it in the category shown.
 * Linking and pairing stand in for "add" there because adding would duplicate the entry or split
 * the transfer.
 */
export function acceptRequest(row: QueueRow): QueueRequest {
  const one = `${REVIEW_QUEUE_PATH}/${encodeURIComponent(row.id)}`;
  switch (defaultDecision(row)) {
    case 'link':
      return { label: 'Link', path: one, body: { decision: 'link', transactionId: row.match!.transaction.id } };
    case 'pair':
      return { label: 'Pair', path: `${REVIEW_QUEUE_PATH}/pair`, body: { id: row.id, peerId: row.transferPair!.id } };
    default:
      return { label: 'Add', path: one, body: addBody(row, row.isTransfer, row.suggestedCategoryId) };
  }
}

/** Swiping a row left ignores it. */
export function ignoreRequest(row: Pick<QueueRow, 'id'>): QueueRequest {
  return { label: 'Ignore', path: `${REVIEW_QUEUE_PATH}/${encodeURIComponent(row.id)}`, body: { decision: 'ignore' } };
}
