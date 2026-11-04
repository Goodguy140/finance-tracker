import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppAccountPage, registerMonths } from "@/lib/api-v1/accounts";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/accounts/:id?months=3|12 — the website's account page for one account: its balance,
 * this month's money in and out, the register with a running balance over the last 3 or 12
 * months, the bank it syncs from, its recurring rules and savings goals. 404 for an account that
 * is not the user's. Scope `app`.
 */
export async function GET(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "account");
  if (!authorized.ok) return authorized.response;
  const months = registerMonths(new URL(request.url).searchParams.get("months"));
  const page = await loadAppAccountPage(authorized.auth.user, (await params).id, months);
  if (!page) return apiError("Account not found.", 404);
  return NextResponse.json(page, { headers: NO_STORE });
}
