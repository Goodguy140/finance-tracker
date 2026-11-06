import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { deletePlanFromApi, updatePlanFromApi } from "@/lib/api-v1/planned";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/v1/planned/:id — replaces an open plan's fields (the same body as POST). 409 once it has happened. Scope `app`. */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "planned-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await updatePlanFromApi(prisma, authorized.auth.user.id, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { headers: NO_STORE });
}

/** DELETE /api/v1/planned/:id — "No, remove it": the plan goes, and nothing in the log changes. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "planned-write");
  if (!authorized.ok) return authorized.response;
  if (!(await deletePlanFromApi(prisma, authorized.auth.user.id, (await params).id))) return apiError("Plan not found.", 404);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
