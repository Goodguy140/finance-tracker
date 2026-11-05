import { NextResponse } from "next/server";
import { syncBankForApp } from "@/lib/api-v1/banks";
import { apiError, authorizeAppDevice, NO_STORE } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { createSyncBankDeps, syncBank } from "@/lib/plaid/sync-bank";
import { PlaidNotConfiguredError } from "@/lib/plaid/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/banks/:id/sync — "Sync now" for one bank, as on the website's Settings → Banks:
 * runs whatever the background sweep's schedule, and answers `{ tone, message, staged,
 * needsSignIn }`. What it finds waits on Review. It can take as long as the bank takes to
 * answer. Device tokens only.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeAppDevice(request, "banks-sync");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const { id } = await context.params;

  let synced;
  try {
    synced = await syncBankForApp(
      { db: prisma, sync: async (itemId) => syncBank(await createSyncBankDeps(), itemId) },
      auth.user.id,
      id,
    );
  } catch (err) {
    if (err instanceof PlaidNotConfiguredError) return apiError("Bank connections are not set up on this server.", 503);
    throw err;
  }
  if (!synced.ok) return apiError(synced.error, synced.status);

  const { outcome, institutionName } = synced;
  if (outcome.kind !== "busy") {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action:
        outcome.kind === "synced"
          ? AUDIT_ACTIONS.plaid_item_sync_succeeded
          : outcome.kind === "needs-reauth"
            ? AUDIT_ACTIONS.plaid_item_reauth_required
            : AUDIT_ACTIONS.plaid_item_sync_failed,
      targetType: "PlaidItem",
      targetId: synced.plaidItemId,
      metadata:
        outcome.kind === "synced"
          ? {
              institution: institutionName,
              staged: outcome.summary.staged,
              pages: outcome.summary.pages,
              skippedUnmapped: outcome.summary.skipped.unmapped,
              skippedBeforeCutoff: outcome.summary.skipped.beforeCutoff,
              via: "app",
            }
          : { institution: institutionName, error: synced.message, via: "app" },
      headers: request.headers,
    });
  }

  return NextResponse.json(
    { tone: synced.tone, message: synced.message, staged: synced.staged, needsSignIn: synced.needsSignIn },
    { headers: NO_STORE },
  );
}
