import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppOwedToYou } from "@/lib/api-v1/owed";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { homeCurrencyOf } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/owed — what people owe the user back, as the Expense Log's "Owed to you" lists it:
 * every share still outstanding and those paid back in the last 30 days, with the expense each is
 * owed on and the total still to come back. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "owed");
  if (!authorized.ok) return authorized.response;
  const { user } = authorized.auth;
  return NextResponse.json(await loadAppOwedToYou(prisma, user.id, homeCurrencyOf(user.countryCode)), { headers: NO_STORE });
}
