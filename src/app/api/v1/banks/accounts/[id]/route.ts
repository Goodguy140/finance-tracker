import { NextResponse } from "next/server";
import { mapBankAccountForApp } from "@/lib/api-v1/banks";
import { apiError, authorizeAppDevice, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PUT /api/v1/banks/accounts/:id with `{ accountId }` (or `null`) — which app account a bank
 * account's transactions go to, as the picker on the website's Settings → Banks sets it. An
 * account left unmatched is not synced. Device tokens only.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeAppDevice(request, "banks-accounts");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const { id } = await context.params;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;

  const mapped = await mapBankAccountForApp(prisma, auth.user.id, id, read.body);
  if (!mapped.ok) return apiError(mapped.error, mapped.status);
  if (mapped.account) {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.plaid_account_mapped,
      targetType: "PlaidAccount",
      targetId: mapped.plaidAccount.id,
      metadata: { plaidAccount: mapped.plaidAccount.name, account: mapped.account.name, via: "app" },
      headers: request.headers,
    });
  }
  return NextResponse.json({ ok: true, accountId: mapped.account?.id ?? null }, { headers: NO_STORE });
}
