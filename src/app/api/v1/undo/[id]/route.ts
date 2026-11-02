import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { TransactionType } from "@prisma/client";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { undoDeleteFromApi } from "@/lib/api-v1/transactions";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/undo/:undoId — puts back an entry `DELETE /api/v1/transactions/:id` deleted in
 * the last 15 minutes. 409 with the reason when it cannot. Scope `app`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "transactions-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const result = await undoDeleteFromApi(prisma, auth.user.id, (await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409, headers: NO_STORE });

  if (result.type === TransactionType.EXPENSE) scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_transaction_restored,
    targetType: "transaction",
    targetId: result.transaction?.id ?? null,
    metadata: { tokenId: auth.token.id, via: "app" },
    headers: await headers(),
  });
  return NextResponse.json({ transaction: result.transaction }, { headers: NO_STORE });
}
