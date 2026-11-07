import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseSearchQuery, searchTransactionsForApi } from "@/lib/api-v1/search";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/search?q=&type=expense|income|transfer&accountId=&categoryId=&tagId=&needsReview=
 *   &limit=1..500&cursor=
 * Every month at once, as the website's Search transactions page finds them: `q` matches the
 * title, note, bank text or an amount; an account matches either side of a transfer. The rows are
 * `GET /api/v1/transactions`'s, newest first; the first page also carries `totals`
 * `{ count, spentCents, receivedCents }` in `currency`. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "search");
  if (!authorized.ok) return authorized.response;
  const parsed = parseSearchQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const result = await searchTransactionsForApi(prisma, authorized.auth.user, parsed.query);
  if (!result.ok) return apiError(result.error, 400);
  return NextResponse.json(
    { transactions: result.transactions, nextCursor: result.nextCursor, bulkEdit: true, currency: result.currency, totals: result.totals },
    { headers: NO_STORE },
  );
}
