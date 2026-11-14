import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { deleteReconciliationFromApi } from "@/lib/api-v1/reconcile";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; reconciliationId: string }> };

/** DELETE /api/v1/accounts/:id/reconcile/:reconciliationId — the website's Forget; the balance it kept stays. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "accounts-write");
  if (!authorized.ok) return authorized.response;
  const { id, reconciliationId } = await params;
  const result = await deleteReconciliationFromApi(prisma, authorized.auth.user.id, id, reconciliationId);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
