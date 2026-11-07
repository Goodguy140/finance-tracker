import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppInvestments } from "@/lib/api-v1/investments";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/investments — the website's Investments card: this year's TFSA, RRSP and FHSA room
 * (with the figures entered from CRA), each investment account's value and return this year and
 * over 12 months, the newest contributions, withdrawals and portfolio values, deposits into a
 * registered account that do not count toward room yet, and the accounts the forms can use. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppInvestments(prisma, authorized.auth.user), { headers: NO_STORE });
}
