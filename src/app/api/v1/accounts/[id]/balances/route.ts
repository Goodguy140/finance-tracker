import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { parseBalanceBody, recordManualBalance } from "@/lib/api-v1/balances";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/accounts/:id/balances — records `{ "balanceCents", "date": "YYYY-MM-DD" }` as the
 * person's own balance for that day, as Settings → Accounts does on the website: what the account
 * holds (negative if overdrawn), or for a card or loan what is owed, as a positive number. A second
 * entry for the same day replaces the first. 400 for a date after today; 404 for an account that is
 * not the user's; 409 for an archived one. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "account-balance");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseBalanceBody(read.body, currentYmdInTimeZone(auth.user.timezone));
  if (!parsed.ok) return apiError(parsed.error, 400);

  const accountId = (await params).id;
  const outcome = await recordManualBalance(prisma, auth.user.id, accountId, parsed.value);
  if (outcome === "not_found") return apiError("Account not found.", 404);
  if (outcome === "archived") return apiError("This account is archived, so its balance is no longer tracked.", 409);

  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_balance_recorded,
    targetType: "Account",
    targetId: accountId,
    metadata: { tokenId: auth.token.id, via: auth.token.kind === "device" ? "app" : "api", date: parsed.value.date },
    headers: await headers(),
  });
  return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE });
}
