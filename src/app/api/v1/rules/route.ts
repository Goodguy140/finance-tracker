import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { createTransactionRuleFromApi } from "@/lib/api-v1/transaction-rules";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/rules `{ match, texts, type?, accountId?, categoryId?, rename?, tag? }` — adds a
 * rule after the user's others, as Settings → Rules does: `match` is `contains` (the default), `is`
 * or `starts_with`; any of `texts` matching is enough; it needs a category, a new title or a tag to
 * set. 201 `{ id, matches }`, `matches` being how many past entries an apply would change (nothing
 * is changed yet). Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "rules-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await createTransactionRuleFromApi(prisma, authorized.auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id, matches: result.matches }, { status: 201, headers: NO_STORE });
}
