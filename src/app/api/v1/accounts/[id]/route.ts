import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { patchAccountFromApi } from "@/lib/api-v1/account-edits";
import { loadAppAccountPage, registerMonths } from "@/lib/api-v1/accounts";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/accounts/:id?months=3|12 — the website's account page for one account: its balance,
 * this month's money in and out, the register with a running balance over the last 3 or 12
 * months, the bank it syncs from, its recurring rules and savings goals. 404 for an account that
 * is not the user's. Scope `app`.
 */
export async function GET(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "account");
  if (!authorized.ok) return authorized.response;
  const months = registerMonths(new URL(request.url).searchParams.get("months"));
  const page = await loadAppAccountPage(authorized.auth.user, (await params).id, months);
  if (!page) return apiError("Account not found.", 404);
  return NextResponse.json(page, { headers: NO_STORE });
}

/**
 * PATCH /api/v1/accounts/:id — any of Settings → Accounts' fields: `name`, `type`, `currency`
 * (kept once the account holds money in it), `countsAsSavings`, a credit card's
 * `creditLimitCents` and `paymentDueDay` (null clears either), and `archived` (refused while a
 * recurring rule, contribution or portfolio value uses the account). 400 with the reason. Scope `app`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "accounts-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await patchAccountFromApi(prisma, authorized.auth.user.id, (await params).id, read.body, request.headers);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { headers: NO_STORE });
}
