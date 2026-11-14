import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { serializeYearEnd } from "@/lib/api-v1/year-end";
import { loadYearEndReport } from "@/lib/reports/year-summary-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/year?year=YYYY — the website's year-end summary: the year in review, totals
 * by tag for tax time, and registered accounts' contributions and withdrawals. A year with no
 * activity falls back to last year, as on the website. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "reports");
  if (!authorized.ok) return authorized.response;
  const year = new URL(request.url).searchParams.get("year") ?? undefined;
  return NextResponse.json(serializeYearEnd(await loadYearEndReport(authorized.auth.user, year)), { headers: NO_STORE });
}
