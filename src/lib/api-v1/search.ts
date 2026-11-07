import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, transactionPageForApi } from "@/lib/api-v1/transactions";
import { homeCurrencyOf } from "@/lib/home-currency";
import { transactionSearchWhere, transactionTotalsWhere } from "@/lib/search/search-data";
import {
  createSavedSearch,
  deleteSavedSearch,
  loadSavedSearches,
  SavedSearchError,
} from "@/lib/search/saved-searches";
import { MAX_SAVED_SEARCH_NAME_LENGTH, type SearchTransactionType, type TransactionSearchFilter } from "@/lib/search/search-paths";

/**
 * The website's Search transactions page for the phone: every month at once, filtered by words or
 * an amount, type, account (either side of a transfer), category and tag, with what it all adds up
 * to; and the saved searches kept beside it, each with its running total.
 */

const TYPES = { expense: "EXPENSE", income: "INCOME", transfer: "TRANSFER" } as const satisfies Record<string, SearchTransactionType>;
const API_TYPES = { EXPENSE: "expense", INCOME: "income", TRANSFER: "transfer" } as const;

const id = z.string().min(1).max(100);

const searchQuerySchema = z.object({
  q: z.string().trim().max(100, "'q' is too long.").optional(),
  type: z.enum(["expense", "income", "transfer"]).optional(),
  accountId: id.optional(),
  categoryId: id.optional(),
  tagId: id.optional(),
  /** The phone's Needs review filter, which narrows a search further. */
  needsReview: z.enum(["true", "false"], "'needsReview' must be true or false.").optional(),
  limit: z.coerce.number().int().min(1).max(API_LIST_MAX_LIMIT).default(API_LIST_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

type SearchQuery = z.infer<typeof searchQuerySchema>;

export function parseSearchQuery(params: URLSearchParams): { ok: true; query: SearchQuery } | { ok: false; error: string } {
  const raw = Object.fromEntries([...params.entries()].filter(([, v]) => v !== ""));
  const parsed = searchQuerySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid query." };
  return { ok: true, query: parsed.data };
}

function filterOf(query: Pick<SearchQuery, "q" | "type" | "accountId" | "categoryId" | "tagId">): TransactionSearchFilter {
  return {
    query: query.q || undefined,
    type: query.type ? TYPES[query.type] : undefined,
    accountId: query.accountId,
    categoryId: query.categoryId,
    tagId: query.tagId,
  };
}

/**
 * One page of what a search finds, newest first, and on the first page its totals: how many,
 * spent and received in the home currency (transfers counted, not summed), as `/search` shows.
 * Ids that are not the user's find nothing, since every row is the user's own.
 */
export async function searchTransactionsForApi(db: PrismaClient, user: { id: string; countryCode: string }, query: SearchQuery) {
  const filter = filterOf(query);
  const base = transactionSearchWhere(user.id, filter);
  const where = query.needsReview ? { AND: [base, { needsReview: query.needsReview === "true" }] } : base;
  const currency = homeCurrencyOf(user.countryCode);
  const [page, totals] = await Promise.all([
    transactionPageForApi(db, user.id, where, query.limit, query.cursor),
    query.cursor ? null : transactionTotalsWhere(db, where, currency),
  ]);
  if (!page.ok) return page;
  return { ...page, currency, totals };
}

/** `GET /api/v1/saved-searches`: each with its filters, as `/api/v1/search` takes them, and its totals now. */
export async function serializeSavedSearches(db: PrismaClient, user: { id: string; countryCode: string }) {
  const saved = await loadSavedSearches(db, user);
  return {
    currency: homeCurrencyOf(user.countryCode),
    searches: saved.map((s) => ({
      id: s.id,
      name: s.name,
      q: s.filter.query ?? null,
      type: s.filter.type ? API_TYPES[s.filter.type] : null,
      accountId: s.filter.accountId ?? null,
      categoryId: s.filter.categoryId ?? null,
      tagId: s.filter.tagId ?? null,
      count: s.count,
      spentCents: s.spentCents,
      receivedCents: s.receivedCents,
      summary: s.summary,
    })),
  };
}

const saveSchema = z
  .object({
    name: z.string().trim().min(1, "Give the search a name.").max(MAX_SAVED_SEARCH_NAME_LENGTH, `Keep the name under ${MAX_SAVED_SEARCH_NAME_LENGTH} characters.`),
    q: z.string().trim().max(100, "'q' is too long.").nullish(),
    type: z.enum(["expense", "income", "transfer"]).nullish(),
    accountId: id.nullish(),
    categoryId: id.nullish(),
    tagId: id.nullish(),
  })
  .strict();

export type SavedSearchResult = { ok: true; id: string } | { ok: false; status: 400 | 404; error: string };

function refusal(err: unknown): SavedSearchResult {
  if (err instanceof SavedSearchError) return { ok: false, status: err.notFound ? 404 : 400, error: err.message };
  throw err;
}

/** `POST /api/v1/saved-searches`: the search on screen, under a name. */
export async function saveSearchFromApi(db: PrismaClient, userId: string, body: unknown): Promise<SavedSearchResult> {
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Name the search." };
  const { name, q, type, accountId, categoryId, tagId } = parsed.data;
  try {
    const savedId = await createSavedSearch(db, userId, {
      name,
      query: q ?? null,
      type: type ? TYPES[type] : null,
      accountId: accountId ?? null,
      categoryId: categoryId ?? null,
      tagId: tagId ?? null,
    });
    return { ok: true, id: savedId };
  } catch (err) {
    return refusal(err);
  }
}

export async function deleteSavedSearchFromApi(db: PrismaClient, userId: string, savedId: string): Promise<SavedSearchResult> {
  try {
    await deleteSavedSearch(db, userId, savedId);
    return { ok: true, id: savedId };
  } catch (err) {
    return refusal(err);
  }
}
