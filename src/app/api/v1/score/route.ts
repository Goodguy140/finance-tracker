import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppScore } from "@/lib/api-v1/insights";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/score — the financial score as the website's Insights page shows it: the number and
 * its band, the four pillars, each factor with what was measured, and where to improve. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "score");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppScore(authorized.auth.user), { headers: NO_STORE });
}
