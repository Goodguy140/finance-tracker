import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { deleteSavedSearchFromApi } from "@/lib/api-v1/search";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/saved-searches/:id — the saved search goes; the transactions it found are untouched. Scope `app`. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "search-write");
  if (!authorized.ok) return authorized.response;
  const result = await deleteSavedSearchFromApi(prisma, authorized.auth.user.id, (await params).id);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
