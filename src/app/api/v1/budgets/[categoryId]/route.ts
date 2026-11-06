import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { patchBudgetFromApi } from "@/lib/api-v1/budget-edits";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ categoryId: string }> };

/**
 * PATCH /api/v1/budgets/:categoryId `{ monthlyCents?, rollover?, yearlyCents? }` — an expense
 * category's monthly budget from this month on (null removes it, every month), rollover from this
 * month, and its yearly budget from this year on (null removes it). Scope `app`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "budgets-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await patchBudgetFromApi(prisma, authorized.auth.user, (await params).categoryId, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
