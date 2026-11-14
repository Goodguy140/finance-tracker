import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { deleteCategoryFromApi, patchCategoryFromApi } from "@/lib/api-v1/category-edits";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/categories/:id — any of `name`, `groupName` (empty or null takes it out of its
 * group) and `spendingRole` (`need`, `want`, or null for the guess). Renaming it to another
 * category's name merges it into that one, as on the website: `mergedInto` says which. Scope `app`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "categories-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await patchCategoryFromApi(prisma, authorized.auth.user, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id, mergedInto: result.mergedInto }, { headers: NO_STORE });
}

/**
 * DELETE /api/v1/categories/:id?moveTo=<categoryId> — one in use needs `moveTo`, another category
 * of the same kind its entries, budgets and rules move to; the last of a kind is kept. Scope `app`.
 */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "categories-write");
  if (!authorized.ok) return authorized.response;
  const moveTo = new URL(request.url).searchParams.get("moveTo");
  const result = await deleteCategoryFromApi(prisma, authorized.auth.user, (await params).id, moveTo);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
