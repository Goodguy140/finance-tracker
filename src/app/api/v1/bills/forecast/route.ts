import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppBillsForecast, parseForecastQuery } from "@/lib/api-v1/bills-forecast";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/bills/forecast?days=30|60|90&transfers=true|false — the dashboard's Upcoming bills:
 * every bill, pay and open plan due from today through `days` days ahead (this month's overdue
 * ones first), by day with the running net, and the totals. With `transfers` (the default),
 * recurring transfers and each card's next payment are listed too, outside the totals and the
 * running net. In the home currency. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring");
  if (!authorized.ok) return authorized.response;
  const parsed = parseForecastQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(parsed.error, 400);
  return NextResponse.json(await loadAppBillsForecast(prisma, authorized.auth.user, parsed), { headers: NO_STORE });
}
