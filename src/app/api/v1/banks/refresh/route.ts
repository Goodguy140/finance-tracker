import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { PlaidApiError } from "@/lib/plaid/client";
import { describeLogRefresh, LOG_REFRESH_INTERVAL_MINUTES } from "@/lib/plaid/log-refresh";
import { sweepDuePlaidItems } from "@/lib/plaid-sync-scheduler";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/banks/refresh — checks this user's banks not checked in the last few minutes,
 * as the refresh icon on the website's transaction log does, and answers the sentence it shows
 * (`{ tone, message }`). What it finds waits in the review queue. Scope `app`. It can take as
 * long as the banks take to answer.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "banks-refresh");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;

  let summary: Awaited<ReturnType<typeof sweepDuePlaidItems>>;
  try {
    summary = await sweepDuePlaidItems(new Date(), { userId: auth.user.id, intervalMinutes: LOG_REFRESH_INTERVAL_MINUTES });
  } catch (err) {
    console.error("[plaid] refresh from the app failed", err);
    const message =
      err instanceof PlaidApiError && err.message ? err.message : "The banks could not be checked. Try again later.";
    return apiError(message, 502);
  }

  if (summary.synced > 0) {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.plaid_item_sync_succeeded,
      metadata: { mode: "app-refresh", banks: summary.synced, staged: summary.staged, tokenId: auth.token.id, via: "app" },
      headers: await headers(),
    });
  }
  const { tone, message } = describeLogRefresh(summary);
  return NextResponse.json({ tone, message }, { headers: NO_STORE });
}
