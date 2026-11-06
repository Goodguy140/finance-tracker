import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { deleteTransactionFromApi, getTransactionForApi, updateTransactionFromApi } from "@/lib/api-v1/transactions";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "No transaction with that id." }, { status: 404, headers: NO_STORE });

/** GET /api/v1/transactions/:id — one entry as the list shows it. Scope `transactions:read`. */
export async function GET(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.transactionsRead, "transactions-read");
  if (!authorized.ok) return authorized.response;
  const transaction = await getTransactionForApi(prisma, authorized.auth.user.id, (await params).id);
  if (!transaction) return notFound();
  return NextResponse.json({ transaction }, { headers: NO_STORE });
}

/**
 * PATCH /api/v1/transactions/:id with any of `title`, `note`, `date`, `postedDate` (null clears),
 * `amountCents`, `categoryId`, `accountId` (null clears), a transfer's `transferAccountId` (null
 * clears), `tags` (the whole list), `reviewed: true`, and an expense's `splits` (all its lines) or
 * `owedShares` (everyone who owes part of it back, with `paidCents` for what was paid in all).
 * Returns the entry as it now is. Scope `app`: the phone edits, a personal access token with
 * `transactions:write` still only adds, as it always could.
 */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "transactions-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
  }
  const result = await updateTransactionFromApi(prisma, auth.user.id, (await params).id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });

  if (result.transaction.type === "expense") scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_transaction_updated,
    targetType: "transaction",
    targetId: result.transaction.id,
    metadata: { tokenId: auth.token.id, via: "app", fields: Object.keys(body as object) },
    headers: await headers(),
  });
  return NextResponse.json({ transaction: result.transaction }, { headers: NO_STORE });
}

/**
 * DELETE /api/v1/transactions/:id — deletes the entry at once and answers its `undoId`, which
 * `POST /api/v1/undo/:undoId` turns back into the entry for 15 minutes. Scope `app`.
 */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "transactions-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const id = (await params).id;
  const deleted = await deleteTransactionFromApi(prisma, auth.user.id, id);
  if (!deleted) return notFound();

  if (deleted.type === "expense") scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_transaction_deleted,
    targetType: "transaction",
    targetId: id,
    metadata: { tokenId: auth.token.id, via: "app", undoId: deleted.undoId },
    headers: await headers(),
  });
  return NextResponse.json({ undoId: deleted.undoId }, { headers: NO_STORE });
}
