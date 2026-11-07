import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { serializeCategoryTrend } from "@/lib/api-v1/category-merchant";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { loadCategoryTrend } from "@/lib/reports/category-merchant-data";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/categories/:id/trend — the website's category page: the category by month for up
 * to two years against its budget, its usual month, this month's pace, top payees and biggest
 * entries. An expense or income category of the user's; 404 otherwise. Scope `app`.
 */
export async function GET(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "category-trend");
  if (!authorized.ok) return authorized.response;
  const loaded = await loadCategoryTrend(authorized.auth.user, (await params).id);
  if (!loaded) return apiError("Category not found.", 404);
  return NextResponse.json(serializeCategoryTrend(loaded), { headers: NO_STORE });
}
