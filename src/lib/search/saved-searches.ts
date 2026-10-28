import type { PrismaClient, SavedSearch } from "@prisma/client";
import { homeCurrencyOf } from "@/lib/home-currency";
import { formatCurrency } from "@/lib/money";
import { transactionSearchTotals, type SearchHit, type TransactionSearchTotals } from "@/lib/search/search-data";
import {
  MAX_SAVED_SEARCHES,
  parseSearchTransactionType,
  searchPageHref,
  type TransactionSearchFilter,
} from "@/lib/search/search-paths";

/**
 * Saved searches: a `/search` the user named. Each is shown with what it finds now, so a
 * "Coffee this year" or "Everything tagged #trip" reads as a running total.
 */

/** How many the master search lists. */
const PALETTE_SAVED_LIMIT = 6;

export type SavedSearchView = TransactionSearchTotals & { id: string; name: string; href: string; summary: string };

export function savedSearchFilter(row: Pick<SavedSearch, "query" | "type" | "accountId" | "categoryId" | "tagId">): TransactionSearchFilter {
  return {
    query: row.query ?? undefined,
    type: parseSearchTransactionType(row.type ?? undefined),
    accountId: row.accountId ?? undefined,
    categoryId: row.categoryId ?? undefined,
    tagId: row.tagId ?? undefined,
  };
}

/** "12 transactions · Spent $340.00", the line under a saved search's name. */
export function describeSearchTotals(totals: TransactionSearchTotals, currency: string): string {
  return [
    `${totals.count} ${totals.count === 1 ? "transaction" : "transactions"}`,
    totals.spentCents !== 0 ? `Spent ${formatCurrency(totals.spentCents, currency)}` : null,
    totals.receivedCents !== 0 ? `Received ${formatCurrency(totals.receivedCents, currency)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The user's saved searches, by name, each with its totals as of now. */
export async function loadSavedSearches(
  db: PrismaClient,
  user: { id: string; countryCode: string },
  options: { nameContains?: string; limit?: number } = {},
): Promise<SavedSearchView[]> {
  const rows = await db.savedSearch.findMany({
    where: { userId: user.id, ...(options.nameContains ? { name: { contains: options.nameContains } } : {}) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: options.limit ?? MAX_SAVED_SEARCHES,
  });
  const currency = homeCurrencyOf(user.countryCode);
  return Promise.all(
    rows.map(async (row) => {
      const filter = savedSearchFilter(row);
      const totals = await transactionSearchTotals(db, user.id, filter, currency);
      return { id: row.id, name: row.name, href: searchPageHref(filter), summary: describeSearchTotals(totals, currency), ...totals };
    }),
  );
}

/**
 * Saved searches for the master search: all of them (up to a handful) when the box is empty,
 * otherwise the ones whose name holds the query.
 */
export async function savedSearchHits(
  db: PrismaClient,
  user: { id: string; countryCode: string },
  query: string,
): Promise<SearchHit[]> {
  const q = query.trim();
  const saved = await loadSavedSearches(db, user, { nameContains: q || undefined, limit: PALETTE_SAVED_LIMIT });
  return saved.map((s) => ({ kind: "saved", id: s.id, title: s.name, detail: `Saved search · ${s.summary}`, href: s.href }));
}
