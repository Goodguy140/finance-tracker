import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { bulkEditFromApi } from "@/lib/api-v1/bulk-edit";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/transactions/bulk `{ ids, op, value? }` — one change to several expenses, as the
 * Expense Log's Select mode makes it: `category` (value: category id; split expenses are skipped),
 * `account` (value: account id), `tag` (value: the tag), `reviewed`, or `delete` (each comes back
 * with `POST /api/v1/undo/:undoId` for 15 minutes). Ids that are not the user's expenses are
 * ignored. 200 `{ changed, skipped, undoIds }`. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "transactions-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await bulkEditFromApi(prisma, auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, 400);

  scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: result.op === "delete" ? AUDIT_ACTIONS.api_transaction_deleted : AUDIT_ACTIONS.api_transaction_updated,
    targetType: "transaction",
    targetId: null,
    metadata: { tokenId: auth.token.id, via: auth.token.kind === "device" ? "app" : "api", bulk: result.op, picked: result.count, changed: result.changed },
    headers: await headers(),
  });
  return NextResponse.json({ changed: result.changed, skipped: result.skipped, undoIds: result.undoIds }, { headers: NO_STORE });
}
