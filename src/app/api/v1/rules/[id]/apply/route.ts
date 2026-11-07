import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { applyTransactionRuleFromApi } from "@/lib/api-v1/transaction-rules";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/rules/:id/apply — rewrites the past entries the rule matches, as Settings → Rules'
 * Apply does: title, category, account, note, tag and transfer, never the amount. 200 `{ updated }`.
 * Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "rules-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const ruleId = (await params).id;
  const result = await applyTransactionRuleFromApi(prisma, auth.user.id, ruleId);
  if (!result.ok) return apiError(result.error, result.status);
  if (result.updated > 0) {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.transaction_rule_applied,
      targetType: "TransactionRule",
      targetId: ruleId,
      metadata: { updated: result.updated, tokenId: auth.token.id, via: auth.token.kind === "device" ? "app" : "api" },
      headers: await headers(),
    });
    scheduleBudgetAlertEmails(auth.user.id);
  }
  return NextResponse.json({ updated: result.updated }, { headers: NO_STORE });
}
