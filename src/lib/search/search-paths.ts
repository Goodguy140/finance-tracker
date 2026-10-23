import { ymdFromDateUtc } from "@/lib/date-only";

/**
 * The master search's pure parts, shared by the server query, the palette and the `/search`
 * page. Kept apart from `search-data.ts` so the browser bundle never pulls in Prisma.
 */

export type TransactionSearchFilter = {
  query?: string;
  categoryId?: string;
  accountId?: string;
  tagId?: string;
  type?: SearchTransactionType;
};

export type SearchTransactionType = "EXPENSE" | "INCOME" | "TRANSFER";

export function parseSearchTransactionType(raw: string | undefined): SearchTransactionType | undefined {
  return raw === "EXPENSE" || raw === "INCOME" || raw === "TRANSFER" ? raw : undefined;
}

/** The shortest query worth sending to the database; one letter matches nearly everything. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Reads "12.50", "$1,200" or "-40" as cents, for finding a transaction by its amount. Null for
 * anything that is not plainly a number, so "7-eleven" stays a text search.
 */
export function parseAmountQuery(raw: string): number | null {
  const s = raw.trim().replace(/^-/, "").replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

/** Where a transaction opens: the dashboard on its month, with its edit dialog up. */
export function transactionHref(id: string, date: Date): string {
  return `/?month=${ymdFromDateUtc(date).slice(0, 7)}&open=${encodeURIComponent(id)}`;
}

export function searchPageHref(filter: TransactionSearchFilter): string {
  const params = new URLSearchParams();
  if (filter.query?.trim()) params.set("q", filter.query.trim());
  if (filter.categoryId) params.set("category", filter.categoryId);
  if (filter.accountId) params.set("account", filter.accountId);
  if (filter.tagId) params.set("tag", filter.tagId);
  if (filter.type) params.set("type", filter.type);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}
