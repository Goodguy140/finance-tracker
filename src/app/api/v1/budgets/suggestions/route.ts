import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { applyBudgetSuggestionsFromApi, loadAppBudgetSuggestions } from "@/lib/api-v1/category-edits";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/budgets/suggestions — the website's Suggest budgets: a monthly amount per expense
 * category from the last 3 and the last 6 full months (the median month, rounded up), with each
 * month's spend, the budgets in force and average income. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "budgets");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppBudgetSuggestions(prisma, authorized.auth.user), { headers: NO_STORE });
}

/** POST /api/v1/budgets/suggestions — `{ budgets: [{ categoryId, limitCents }] }`, set from this month on. Scope `app`. */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "budgets-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await applyBudgetSuggestionsFromApi(prisma, authorized.auth.user, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ set: result.set }, { headers: NO_STORE });
}
