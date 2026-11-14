import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { reportsPeriodKey, serializeReports } from "@/lib/api-v1/reports";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";
import { loadReportsOverview } from "@/lib/reports/overview";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports?period=12m|YYYY&from=&to=&tagId= — the website's Reports page: totals,
 * income vs spending by month, cash flow, year over year, payees, net worth over time and
 * projected balances. A tag that is not the user's is ignored, as on the website. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "reports");
  if (!authorized.ok) return authorized.response;
  const { user } = authorized.auth;
  const params = new URL(request.url).searchParams;
  const tagId = params.get("tagId");
  const tag = tagId ? await prisma.tag.findFirst({ where: { id: tagId, userId: user.id }, select: { id: true } }) : null;
  const overview = await loadReportsOverview(user, reportsPeriodKey(params), tag?.id ?? null);
  return NextResponse.json(serializeReports(overview), { headers: NO_STORE });
}
