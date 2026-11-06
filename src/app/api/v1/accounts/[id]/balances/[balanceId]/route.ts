import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { deleteManualBalance } from "@/lib/api-v1/balances";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; balanceId: string }> };

/**
 * DELETE /api/v1/accounts/:id/balances/:balanceId — removes a balance the person typed in. A bank's
 * balance cannot be deleted (its next sync would only record it again), so it answers 404 like any
 * entry that is not the user's own. Scope `app`.
 */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "account-balance");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const { id: accountId, balanceId } = await params;
  if (!(await deleteManualBalance(prisma, auth.user.id, accountId, balanceId))) {
    return apiError("That balance entry was not found.", 404);
  }
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_balance_deleted,
    targetType: "Account",
    targetId: accountId,
    metadata: { tokenId: auth.token.id, via: auth.token.kind === "device" ? "app" : "api", balanceId },
    headers: await headers(),
  });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
