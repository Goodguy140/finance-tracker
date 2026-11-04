import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppNetWorth } from "@/lib/api-v1/accounts";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/net-worth — every open account with its latest balance, and the net worth they add
 * up to over the last year, as Reports' Net worth shows them. Accounts in another currency are
 * listed but left out of the totals. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "net-worth");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppNetWorth(authorized.auth.user), { headers: NO_STORE });
}
