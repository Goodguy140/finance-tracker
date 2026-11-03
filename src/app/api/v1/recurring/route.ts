import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppRecurring } from "@/lib/api-v1/recurring";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/recurring — every recurring bill, pay and transfer that is on, soonest first, each
 * with the occurrence it is waiting on and whether that is overdue, due today or upcoming in the
 * user's timezone. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppRecurring(authorized.auth.user), { headers: NO_STORE });
}
