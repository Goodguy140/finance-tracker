import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { monthlyCentsParam, serializeDebtPayoff } from "@/lib/api-v1/debt-payoff";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { loadDebtPayoff } from "@/lib/debt-payoff-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/debt-payoff?monthlyCents= — the website's Debt payoff page: cards, loans and
 * mortgages with what is owed and their terms, and highest rate first, smallest balance first and
 * minimums only for the monthly amount (the minimums when none is given, never less). The rate
 * and minimum are set with `PATCH /api/v1/accounts/:id`. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "reports");
  if (!authorized.ok) return authorized.response;
  const monthly = monthlyCentsParam(new URL(request.url).searchParams.get("monthlyCents"));
  return NextResponse.json(serializeDebtPayoff(await loadDebtPayoff(authorized.auth.user, monthly)), { headers: NO_STORE });
}
