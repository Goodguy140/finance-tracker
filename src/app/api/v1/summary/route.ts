import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { loadAppSummary } from "@/lib/api-v1/summary";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/summary — the phone app's Home screen for the month now running: safe to spend,
 * budgets to watch, bills and pay due in the next 7 days, and the bank queue and needs-review
 * counts. Scope `app`, which only device tokens hold.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "summary");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppSummary(authorized.auth.user), { headers: NO_STORE });
}
