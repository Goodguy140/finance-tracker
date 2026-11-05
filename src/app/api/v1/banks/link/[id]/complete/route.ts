import { NextResponse } from "next/server";
import { finishAppBankLink } from "@/lib/app-bank-link";
import { apiError, authorizeAppDevice, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { PlaidNotConfiguredError, requirePlaidClient } from "@/lib/plaid/service";
import { historyWindowLabel } from "@/lib/plaid/window";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/banks/link/:id/complete with `{ publicToken }` (a new bank) or `{}` (a fix) —
 * finishes what `POST /api/v1/banks/link` started, once, from the same phone. A new bank answers
 * `{ kind: "linked", plaidItemId, institutionName, accountCount, cutoffDisplay }`; a fix
 * `{ kind: "updated", plaidItemId, institutionName, newAccounts }`. Device tokens only.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeAppDevice(request, "banks-link-complete");
  if (!authorized.ok) return authorized.response;
  const { auth, appDeviceId } = authorized;
  const { id } = await context.params;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const publicToken = (read.body as { publicToken?: unknown } | null)?.publicToken;

  let finished;
  try {
    finished = await finishAppBankLink(
      { db: prisma, plaid: requirePlaidClient },
      { user: auth.user, appDeviceId, linkId: id, publicToken: typeof publicToken === "string" ? publicToken : undefined },
    );
  } catch (err) {
    if (err instanceof PlaidNotConfiguredError) return apiError("Bank connections are not set up on this server.", 503);
    throw err;
  }
  if (!finished.ok) return apiError(finished.error, finished.status);

  if (finished.kind === "updated") {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.plaid_item_update_completed,
      targetType: "PlaidItem",
      targetId: finished.plaidItemId,
      metadata: { updateKind: finished.link.updateKind, institution: finished.institutionName, via: "app" },
      headers: request.headers,
    });
    const { kind, plaidItemId, institutionName, newAccounts } = finished;
    return NextResponse.json({ kind, plaidItemId, institutionName, newAccounts }, { headers: NO_STORE });
  }

  const days = finished.link.historyDays ?? 90;
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.plaid_item_linked,
    targetType: "PlaidItem",
    targetId: finished.plaidItemId,
    metadata:
      finished.mode === "reauth"
        ? { mode: "reauth", institution: finished.institutionName, accounts: finished.accountCount, via: "app" }
        : {
            mode: "create",
            institution: finished.institutionName,
            requestedDays: days,
            historyWindow: historyWindowLabel(days),
            accounts: finished.accountCount,
            via: "app",
          },
    headers: request.headers,
  });
  const { kind, plaidItemId, institutionName, accountCount, cutoffDisplay } = finished;
  return NextResponse.json({ kind, plaidItemId, institutionName, accountCount, cutoffDisplay }, { headers: NO_STORE });
}
