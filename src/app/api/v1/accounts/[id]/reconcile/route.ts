import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { loadAppReconcile, saveReconciliationFromApi } from "@/lib/api-v1/reconcile";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/accounts/:id/reconcile?from=&to=&openingCents=&closingCents= — the website's
 * Reconcile with a statement: the dates and opening balance default to where the last reconciled
 * statement ended; with both balances, the log's entries over those days with a running balance
 * and the difference. Reconciled statements, newest first. Scope `app`.
 */
export async function GET(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "account");
  if (!authorized.ok) return authorized.response;
  const result = await loadAppReconcile(prisma, authorized.auth.user, (await params).id, new URL(request.url).searchParams);
  if (!result.ok) return apiError(result.error, result.status);
  const { ok: _ok, ...body } = result;
  return NextResponse.json(body, { headers: NO_STORE });
}

/**
 * POST /api/v1/accounts/:id/reconcile — `{ from, to, openingCents, closingCents }`: Mark
 * reconciled. Worked out again and refused unless the log matches to the cent; the closing balance
 * is kept as the account's balance that day unless the bank reported one. 201 with its `id`. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "accounts-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await saveReconciliationFromApi(prisma, authorized.auth.user.id, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { status: 201, headers: NO_STORE });
}
