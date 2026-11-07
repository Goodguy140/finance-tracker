import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { deleteGoalFromApi, updateGoalFromApi } from "@/lib/api-v1/goals";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/v1/goals/:id — replaces a goal's fields (the same body as POST). Without `savedCents`, the saved amount stays. Scope `app`. */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "goals-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await updateGoalFromApi(prisma, authorized.auth.user.id, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { headers: NO_STORE });
}

/** DELETE /api/v1/goals/:id — the goal goes; the account it followed is untouched. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "goals-write");
  if (!authorized.ok) return authorized.response;
  const result = await deleteGoalFromApi(prisma, authorized.auth.user.id, (await params).id);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
