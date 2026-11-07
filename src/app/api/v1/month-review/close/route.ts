import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseCloseBody } from "@/lib/api-v1/month-review";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";
import { closeMonth, reopenMonth, reviewMonth } from "@/lib/reports/month-review-data";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/month-review/close `{ month, closed }` — "Mark month closed" (true) or Reopen
 * (false), as on the website. A record only: nothing is locked. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "month-review-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const { user } = authorized.auth;
  const body = parseCloseBody(read.body, reviewMonth(null, user.timezone).currentYm);
  if (!body.ok) return apiError(body.error, 400);
  if (body.closed) await closeMonth(prisma, user.id, body.month);
  else await reopenMonth(prisma, user.id, body.month);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
