import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppRecurring } from "@/lib/api-v1/recurring";
import { createRuleFromApi } from "@/lib/api-v1/recurring-rules";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/recurring — every recurring bill, pay and transfer that is on, soonest first, each
 * with the occurrence it is waiting on and whether that is overdue, due today or upcoming in the
 * user's timezone; then `paused`, the rules turned off, by name. Each carries what the rule sheet
 * needs to change it. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppRecurring(authorized.auth.user), { headers: NO_STORE });
}

/**
 * POST /api/v1/recurring — adds a rule: `{ type, accountId, categoryId | transferAccountId, name,
 * amountCents, cadence, nextExpectedDate, firstDay?, secondDay?, beforeWeekend?, endDate?, note?,
 * autoPost?, cancelUrl?, decideBy? }`, the website's Recurring form. 201 `{ id }`. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await createRuleFromApi(prisma, authorized.auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { status: 201, headers: NO_STORE });
}
