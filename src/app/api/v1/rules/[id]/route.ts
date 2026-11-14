import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { deleteTransactionRuleFromApi, loadAppRule, patchTransactionRuleFromApi } from "@/lib/api-v1/transaction-rules";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/rules/:id — one rule as `GET /api/v1/rules` lists it, `count` (how many rules there
 * are) and `matches`: how many past entries Apply would change. Scope `app`.
 */
export async function GET(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "rules");
  if (!authorized.ok) return authorized.response;
  const found = await loadAppRule(prisma, authorized.auth.user, (await params).id, true);
  if (!found) return apiError("Rule not found.", 404);
  return NextResponse.json(found, { headers: NO_STORE });
}

/**
 * PATCH /api/v1/rules/:id `{ enabled?, match?, texts?, type?, accountId?, categoryId?, rename?, tag? }`
 * — turns the rule on or off and changes what the body names, as Settings → Rules' editor does;
 * what only the website edits is kept. 200 with the rule as `GET` gives it; `matches` is null when
 * only `enabled` was sent. Nothing past is changed until an apply. Scope `app`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "rules-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const ruleId = (await params).id;
  const result = await patchTransactionRuleFromApi(prisma, authorized.auth.user.id, ruleId, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  const found = await loadAppRule(prisma, authorized.auth.user, ruleId, result.changedRule);
  if (!found) return apiError("Rule not found.", 404);
  return NextResponse.json(found, { headers: NO_STORE });
}

/** DELETE /api/v1/rules/:id — deletes the rule; past entries keep what it set. 200 `{ deleted: true }`. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "rules-write");
  if (!authorized.ok) return authorized.response;
  const result = await deleteTransactionRuleFromApi(prisma, authorized.auth.user.id, (await params).id);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ deleted: true }, { headers: NO_STORE });
}
