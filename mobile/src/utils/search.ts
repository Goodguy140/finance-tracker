import type { Me, SavedSearch, SearchTotals, TransactionType } from '@/api/types';
import { formatCents } from '@/utils/money';
import { LIST_PAGE, type ListFilters } from '@/utils/transactions';

/** The website's Search transactions page on the phone: more filters, totals and saved searches. */

export const SEARCH_PATH = '/api/v1/search';
export const SAVED_SEARCHES_PATH = '/api/v1/saved-searches';

export function savedSearchPath(id: string): string {
  return `${SAVED_SEARCHES_PATH}/${encodeURIComponent(id)}`;
}

export function canSearch(me: Me | undefined): boolean {
  return me?.features?.includes('search') ?? false;
}

/** The filters only a search has; any of them looks across every month, as typing does. */
export type SearchFilters = { accountId: string | null; categoryId: string | null; tagId: string | null };

export const NO_SEARCH_FILTERS: SearchFilters = { accountId: null, categoryId: null, tagId: null };

export function isSearching(text: string, more: SearchFilters): boolean {
  return Boolean(text || more.accountId || more.categoryId || more.tagId);
}

/** `GET /api/v1/search` for the words typed and the filters picked. */
export function searchPath(text: string, filters: ListFilters, more: SearchFilters, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(LIST_PAGE) });
  if (text) params.set('q', text);
  if (filters.type) params.set('type', filters.type);
  if (more.accountId) params.set('accountId', more.accountId);
  if (more.categoryId) params.set('categoryId', more.categoryId);
  if (more.tagId) params.set('tagId', more.tagId);
  if (filters.needsReview) params.set('needsReview', 'true');
  if (cursor) params.set('cursor', cursor);
  return `${SEARCH_PATH}?${params.toString()}`;
}

/** "12 transactions · Spent $340.00 · Received $20.00", as the website words a search's totals. */
export function totalsLine(totals: SearchTotals, currency: string): string {
  return [
    `${totals.count} ${totals.count === 1 ? 'transaction' : 'transactions'}`,
    totals.spentCents !== 0 ? `Spent ${formatCents(totals.spentCents, currency)}` : null,
    totals.receivedCents !== 0 ? `Received ${formatCents(totals.receivedCents, currency)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The body for `POST /api/v1/saved-searches`: the search on screen under a name. */
export function savedSearchBody(name: string, text: string, type: TransactionType | null, more: SearchFilters) {
  return { name: name.trim(), q: text || null, type, ...more };
}

/** What applying a saved search puts on screen. */
export function applySavedSearch(saved: SavedSearch): { text: string; type: TransactionType | null; more: SearchFilters } {
  return {
    text: saved.q ?? '',
    type: saved.type,
    more: { accountId: saved.accountId, categoryId: saved.categoryId, tagId: saved.tagId },
  };
}

/** The saved search the screen shows exactly, if any; Needs review is the phone's own and never saved. */
export function savedSearchShown(
  searches: readonly SavedSearch[],
  text: string,
  filters: ListFilters,
  more: SearchFilters,
): SavedSearch | null {
  if (filters.needsReview) return null;
  return (
    searches.find(
      (s) =>
        (s.q ?? '').toLowerCase() === text.toLowerCase() &&
        s.type === filters.type &&
        s.accountId === more.accountId &&
        s.categoryId === more.categoryId &&
        s.tagId === more.tagId,
    ) ?? null
  );
}

/** "Needs review · Spending · on Chequing · in Food · #trip", the filters on screen. */
export function filtersLine(
  filters: ListFilters,
  more: SearchFilters,
  names: { account?: string; category?: string; tag?: string },
  typeLabel: string | undefined,
): string {
  return [
    filters.needsReview ? 'Needs review' : null,
    filters.type ? typeLabel : null,
    more.accountId ? `on ${names.account ?? 'an account'}` : null,
    more.categoryId ? `in ${names.category ?? 'a category'}` : null,
    more.tagId ? `#${names.tag ?? 'a tag'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
