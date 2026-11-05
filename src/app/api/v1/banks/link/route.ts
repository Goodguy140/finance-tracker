import { NextResponse } from "next/server";
import { parseBankLinkRequest, startAppBankLink } from "@/lib/app-bank-link";
import { apiError, authorizeAppDevice, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { PlaidNotConfiguredError, requirePlaidClient } from "@/lib/plaid/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/banks/link — starts connecting a bank in the phone app, or fixing a connection.
 *   { stepUp: { challengeId, response }, mode: "create", historyDays }
 *   { stepUp: { challengeId, response }, mode: "update", plaidItemId, updateKind: "reauth" | "accounts" }
 * `stepUp` is a passkey assertion for `POST /api/v1/app/step-up/options`'s challenge, made with
 * Face ID. Answers `{ linkId, linkToken, cutoffNote }`: the app opens Plaid Link with the token,
 * then finishes with `POST /api/v1/banks/link/:linkId/complete`. Device tokens only.
 */
export async function POST(request: Request) {
  const authorized = await authorizeAppDevice(request, "banks-link");
  if (!authorized.ok) return authorized.response;
  const { auth, appDeviceId } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseBankLinkRequest(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  let started;
  try {
    started = await startAppBankLink(
      { db: prisma, plaid: requirePlaidClient },
      { user: auth.user, appDeviceId, request: parsed.value },
    );
  } catch (err) {
    if (err instanceof PlaidNotConfiguredError) return apiError("Bank connections are not set up on this server.", 503);
    throw err;
  }
  if (!started.ok) return apiError(started.error, started.status);

  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.mfa_verified,
    metadata: { method: "passkey", via: "app", for: "bank-link" },
    headers: request.headers,
  });
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.plaid_link_started,
    targetType: started.link.plaidItemId ? "PlaidItem" : null,
    targetId: started.link.plaidItemId,
    metadata:
      started.link.mode === "update"
        ? { mode: "update", updateKind: started.link.updateKind, institution: started.institutionName, via: "app" }
        : { mode: "create", requestedDays: started.link.historyDays, via: "app" },
    headers: request.headers,
  });

  return NextResponse.json(
    { linkId: started.link.id, linkToken: started.linkToken, cutoffNote: started.cutoffNote },
    { headers: NO_STORE },
  );
}
