import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppCalendar } from "@/lib/api-v1/calendar";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/calendar?month=YYYY-MM — the dashboard's Calendar card for a month (this one by
 * default): Sunday-first weeks, each day's spending, income and entry count, the bills, pay,
 * plans, transfers and card payments still due on it (none for a month already past), the month's
 * totals and its busiest day. In the home currency. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "spending");
  if (!authorized.ok) return authorized.response;
  const result = await loadAppCalendar(prisma, authorized.auth.user, new URL(request.url).searchParams.get("month"));
  if (!result.ok) return apiError(result.error, 400);
  const { ok: _ok, ...body } = result;
  return NextResponse.json(body, { headers: NO_STORE });
}
