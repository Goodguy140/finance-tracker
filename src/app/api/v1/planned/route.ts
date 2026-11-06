import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { createPlanFromApi, loadAppPlans } from "@/lib/api-v1/planned";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/planned — the user's open one-off plans, earliest first, after settling any an entry
 * in the log has turned out to be (as every forecast does). Each says whether its date has passed,
 * which is when the website asks "Did this happen?". Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "planned");
  if (!authorized.ok) return authorized.response;
  const { user } = authorized.auth;
  return NextResponse.json(await loadAppPlans(prisma, user.id, currentYmdInTimeZone(user.timezone)), { headers: NO_STORE });
}

/**
 * POST /api/v1/planned — adds a plan `{ type: "expense" | "income", name, amountCents, date,
 * accountId, categoryId, note? }`, as the website's Plan tab does. 201 with its `id`; 404 for an
 * account (open) or category (of that kind) that is not the user's. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "planned-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await createPlanFromApi(prisma, authorized.auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { status: 201, headers: NO_STORE });
}
