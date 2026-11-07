import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { claimIdempotencyKey, readIdempotencyKey, releaseIdempotencyKey } from "@/lib/api-v1/idempotency";
import {
  createTransactionFromApi,
  getTransactionForApi,
  listTransactionsForApi,
  parseListQuery,
} from "@/lib/api-v1/transactions";
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

  // Reads by a personal access token are audited; the phone app's are not, for the same
  // reason the website's own reads are not: it is the person, signed in.
  if (auth.token.kind === "token") {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.api_transactions_read,
      targetType: "personal_access_token",
      targetId: auth.token.id,
      metadata: { rows: result.transactions.length },
      headers: await headers(),
    });
  }
  return NextResponse.json(
    // `bulkEdit`: this server takes `POST /api/v1/transactions/bulk`, so the phone offers Select.
    { transactions: result.transactions, nextCursor: result.nextCursor, bulkEdit: true },
    { headers: NO_STORE },
  );
}

/**
 * POST /api/v1/transactions with a JSON body:
 *   { "type": "expense" | "income" | "transfer", "amount": 12.5 | "amountCents": 1250, "title"?,
 *     "date"?, "postedDate"?, "category"? | "categoryId"?, "account"? | "accountId"?,
 *     "transferAccount"? | "transferAccountId"? (a transfer's other side, required for one),
 *     "note"?, "tags"? }
 * Scope `transactions:write`. Returns 201 with the entry as GET lists it.
 *
 * An `Idempotency-Key` header (16 to 100 letters, digits, `-` or `_`) makes a retry safe: the
 * same key again within a week answers 200 with the entry the first request added, and
 * `Idempotent-Replayed: true`, rather than adding it twice. The body of a retry is not compared;
 * a new add needs a new key. 409 while the first request is still being handled (try again);
 * 410 when the entry it added has since been deleted (nothing to try again).
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.transactionsWrite, "transactions-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;

  const key = readIdempotencyKey(request.headers);
  if (key === "invalid") {
    return NextResponse.json(
      { error: "'Idempotency-Key' must be 16 to 100 letters, digits, '-' or '_'." },
      { status: 400, headers: NO_STORE },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
  }

  let keyId: string | undefined;
  if (key) {
    const claim = await claimIdempotencyKey(prisma, auth.user.id, key);
    if (claim.status === "busy") {
      return NextResponse.json({ error: "This entry is still being saved. Try again in a moment." }, { status: 409, headers: NO_STORE });
    }
    if (claim.status === "done") {
      const transaction = await getTransactionForApi(prisma, auth.user.id, claim.transactionId);
      if (!transaction) {
        return NextResponse.json({ error: "This entry was already added, and has since been deleted." }, { status: 410, headers: NO_STORE });
      }
      return NextResponse.json({ transaction }, { status: 200, headers: { ...NO_STORE, "Idempotent-Replayed": "true" } });
    }
    keyId = claim.keyId;
  }

  // The phone app is the person typing, as on the website; a token is a script, whose entries
  // wait in Needs review.
  const source = auth.token.kind === "device" ? "app" : "api";
  let result: Awaited<ReturnType<typeof createTransactionFromApi>>;
  try {
    result = await createTransactionFromApi(prisma, auth.user, body, source, { idempotencyKeyId: keyId });
  } catch (err) {
    if (keyId) await releaseIdempotencyKey(prisma, keyId);
    throw err;
  }
  if (!result.ok) {
    if (keyId) await releaseIdempotencyKey(prisma, keyId);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.transaction.type === "expense") scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_transaction_created,
    targetType: "transaction",
    targetId: result.transaction.id,
    metadata: { tokenId: auth.token.id, via: source, type: result.transaction.type },
    headers: await headers(),
  });
  return NextResponse.json({ transaction: result.transaction }, { status: 201, headers: NO_STORE });
}
