import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppInsights } from "@/lib/api-v1/insights";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/insights — what the website's Insights page lists, worked out the same way: the
 * insights showing now, and the ones dismissed or snoozed. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "insights");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppInsights(authorized.auth.user), { headers: NO_STORE });
}
