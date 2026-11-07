import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { serializeMonthReview } from "@/lib/api-v1/month-review";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";
import { loadMonthReview } from "@/lib/reports/month-review-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/month-review?month=YYYY-MM — the website's monthly review: totals against the month
 * before, what moved, where it went, the biggest purchases, budgets kept and missed, what still
 * wants a look, the saved score, and whether the month is closed. Without a month (or with one
 * after this month), the month just finished. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "month-review");
  if (!authorized.ok) return authorized.response;
  const month = new URL(request.url).searchParams.get("month");
  const review = await loadMonthReview(authorized.auth.user, month, prisma);
  return NextResponse.json(serializeMonthReview(review), { headers: NO_STORE });
}
