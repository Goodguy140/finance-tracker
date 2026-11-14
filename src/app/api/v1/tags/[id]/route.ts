import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { deleteTagFromApi, patchTagFromApi } from "@/lib/api-v1/category-edits";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/tags/:id — `{ name }`. Another tag's name merges the two, as on the website: its
 * entries, rules and saved searches move to that tag, and `mergedInto` says which. Scope `app`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "tags-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await patchTagFromApi(prisma, authorized.auth.user.id, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id, mergedInto: result.mergedInto }, { headers: NO_STORE });
}

/** DELETE /api/v1/tags/:id — entries keep everything else; rules that added it stop adding a tag. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "tags-write");
  if (!authorized.ok) return authorized.response;
  const result = await deleteTagFromApi(prisma, authorized.auth.user.id, (await params).id);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
