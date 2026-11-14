import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { changeTransferFromApi, parseTransferChangeBody } from "@/lib/api-v1/transfer-marking";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/transactions/:id/transfer `{ "change": "mark" | "unmark" | "unpair" }` — the
 * Expense Log's Mark as transfer, Not a transfer and Unpair. Answers the entry as it now is.
 * 404 for an entry that is not the user's or not of the kind the change needs (an expense or
 * income to mark, a transfer to unmark, a paired one to unpair); 409 when a split, money owed
 * back or the accounts stand in the way. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "transactions-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseTransferChangeBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const result = await changeTransferFromApi(prisma, auth.user.id, (await params).id, parsed.change);
  if (!result.ok) return apiError(result.error, result.status);

  // Counted as spending again, it may push a budget over.
  if (result.countsAgain) scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_transaction_updated,
    targetType: "transaction",
    targetId: result.transaction.id,
    metadata: { tokenId: auth.token.id, via: "app", fields: [`transfer:${parsed.change}`] },
    headers: await headers(),
  });
  return NextResponse.json({ transaction: result.transaction }, { headers: NO_STORE });
}
