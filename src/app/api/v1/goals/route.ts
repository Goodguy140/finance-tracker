import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { createGoalFromApi, serializeGoals } from "@/lib/api-v1/goals";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";
import { loadSavingsGoals } from "@/lib/savings-goals-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/goals — every savings goal with the Savings goals card's figures: saved, what a
 * dated goal needs a month, the pace it is judged by and when it would be reached; and the
 * accounts a goal can follow. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "goals");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(serializeGoals(await loadSavingsGoals(authorized.auth.user)), { headers: NO_STORE });
}

/**
 * POST /api/v1/goals `{ name, targetCents, targetDate?, accountId?, savedCents? }` — adds a goal,
 * as Settings → Savings goals does: one that follows an account takes its progress from the
 * balance; one without is tracked by hand from `savedCents`. 201 `{ id }`. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "goals-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await createGoalFromApi(prisma, authorized.auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { status: 201, headers: NO_STORE });
}
