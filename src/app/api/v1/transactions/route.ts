import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { createTransactionFromApi, listTransactionsForApi, parseListQuery } from "@/lib/api-v1/transactions";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { prisma } from "@/lib/prisma";

// Token-authenticated, no cookies; never cached.
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD&type=expense|income|transfer
 *   &accountId=&categoryId=&limit=1..500&cursor=
 * Newest first; `nextCursor` pages on. Scope `transactions:read`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.transactionsRead, "transactions-read");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;

  const parsed = parseListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await listTransactionsForApi(prisma, auth.user.id, parsed.query);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_transactions_read,
    targetType: "personal_access_token",
    targetId: auth.token.id,
    metadata: { rows: result.transactions.length },
    headers: await headers(),
  });
  return NextResponse.json({ transactions: result.transactions, nextCursor: result.nextCursor }, { headers: NO_STORE });
}

/**
 * POST /api/v1/transactions with a JSON body:
 *   { "type": "expense" | "income", "amount": 12.5 | "amountCents": 1250, "title"?, "date"?,
 *     "postedDate"?, "category"? | "categoryId"?, "account"? | "accountId"?, "note"?, "tags"? }
 * Scope `transactions:write`. Returns 201 with the entry as GET lists it.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.transactionsWrite, "transactions-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
  }
  const result = await createTransactionFromApi(prisma, auth.user, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (result.transaction.type === "expense") scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_transaction_created,
    targetType: "transaction",
    targetId: result.transaction.id,
    metadata: { tokenId: auth.token.id, type: result.transaction.type },
    headers: await headers(),
  });
  return NextResponse.json({ transaction: result.transaction }, { status: 201, headers: NO_STORE });
}
