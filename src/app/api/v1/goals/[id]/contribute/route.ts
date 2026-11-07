import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { contributeFromApi } from "@/lib/api-v1/goals";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/goals/:id/contribute `{ amountCents }` — puts money toward a hand-tracked goal
 * (positive) or takes it back (negative, never below zero), as Settings → Savings goals' Add does.
 * A goal that follows an account is refused: its balance is the record. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "goals-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await contributeFromApi(prisma, authorized.auth.user.id, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
