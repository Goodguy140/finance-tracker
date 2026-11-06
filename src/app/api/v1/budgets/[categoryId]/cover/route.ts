import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { coverBudgetFromApi } from "@/lib/api-v1/budget-edits";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ categoryId: string }> };

/**
 * POST /api/v1/budgets/:categoryId/cover `{ from: [{ categoryId, amountCents }] }` — covers the
 * category's overage this month from other budgets' room, as the Budgets card's dialog does: its
 * limit goes up and each source's down, for this month on. 400 with the reason when a source has
 * less room than asked, the total is more than the overage, or the category is not over. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "budgets-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await coverBudgetFromApi(prisma, authorized.auth.user, (await params).categoryId, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
