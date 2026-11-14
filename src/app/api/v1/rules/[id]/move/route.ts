import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { moveTransactionRuleFromApi } from "@/lib/api-v1/transaction-rules";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/rules/:id/move `{ direction: "up" | "down" }` — swaps the rule with the one above or
 * below it, as Settings → Rules' arrows do (the top rule moved up stays put). 200 `{ position }`,
 * its place from 1. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "rules-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await moveTransactionRuleFromApi(prisma, authorized.auth.user.id, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ position: result.position }, { headers: NO_STORE });
}
