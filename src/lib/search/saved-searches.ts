import type { PrismaClient, SavedSearch } from "@prisma/client";
import { homeCurrencyOf } from "@/lib/home-currency";
import { formatCurrency } from "@/lib/money";
import { transactionSearchTotals, type SearchHit, type TransactionSearchTotals } from "@/lib/search/search-data";
import {
  MAX_SAVED_SEARCH_NAME_LENGTH,
  MAX_SAVED_SEARCHES,
  parseSearchTransactionType,
  searchPageHref,
  type SearchTransactionType,
  type TransactionSearchFilter,
} from "@/lib/search/search-paths";

/**
 * Saved searches: a `/search` the user named. Each is shown with what it finds now, so a
 * "Coffee this year" or "Everything tagged #trip" reads as a running total.
 */

/** How many the master search lists. */
const PALETTE_SAVED_LIMIT = 6;

export type SavedSearchView = TransactionSearchTotals & {
  id: string;
  name: string;
  href: string;
  summary: string;
  filter: TransactionSearchFilter;
};

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
      return {
        id: row.id,
        name: row.name,
        href: searchPageHref(filter),
        summary: describeSearchTotals(totals, currency),
        filter,
        ...totals,
      };
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

/** Why a saved search was not saved or removed, in words for the person. */
export class SavedSearchError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "SavedSearchError";
  }
}

export type SavedSearchInput = {
  name: string;
  query: string | null;
  type: SearchTransactionType | null;
  accountId: string | null;
  categoryId: string | null;
  tagId: string | null;
};

const COULD_NOT_SAVE = "That search could not be saved. Reload and try again.";

/**
 * Saves a search under a name, for `/search`'s "Save this search" and the phone. An account,
 * category or tag that is not the user's is refused rather than dropped, which would save a wider
 * search than the one shown.
 */
export async function createSavedSearch(db: PrismaClient, userId: string, input: SavedSearchInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new SavedSearchError("Give the search a name.");
  if (name.length > MAX_SAVED_SEARCH_NAME_LENGTH) {
    throw new SavedSearchError(`Keep the name under ${MAX_SAVED_SEARCH_NAME_LENGTH} characters.`);
  }
  const query = input.query?.trim().slice(0, 100) || null;
  const { type, accountId, categoryId, tagId } = input;
  if (!query && !type && !accountId && !categoryId && !tagId) throw new SavedSearchError("Search for something first, then save it.");

  const [account, category, tag, count] = await Promise.all([
    accountId ? db.account.count({ where: { id: accountId, userId } }) : 1,
    categoryId ? db.category.count({ where: { id: categoryId, userId } }) : 1,
    tagId ? db.tag.count({ where: { id: tagId, userId } }) : 1,
    db.savedSearch.count({ where: { userId } }),
  ]);
  if (!account || !category || !tag) throw new SavedSearchError(COULD_NOT_SAVE);
  if (count >= MAX_SAVED_SEARCHES) {
    throw new SavedSearchError(`You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Remove one you no longer use first.`);
  }
  const row = await db.savedSearch.create({
    data: { userId, name, query, type, accountId, categoryId, tagId },
    select: { id: true },
  });
  return row.id;
}

export async function deleteSavedSearch(db: PrismaClient, userId: string, id: string): Promise<void> {
  const { count } = await db.savedSearch.deleteMany({ where: { id, userId } });
  if (count === 0) throw new SavedSearchError("That saved search was already removed.", true);
}
