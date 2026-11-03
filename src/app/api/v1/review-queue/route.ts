import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { reviewQueueForApi } from "@/lib/api-v1/review-queue";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/review-queue — the bank rows waiting for the user, newest first, every period at
 * once: what adding each would write, the entry the matcher would link it to, and the other
 * bank row it could pair with as one transfer. Also the bank's revisions to rows already
 * added, the categories a row can go in, and each linked bank with what it needs (signing in
 * again happens on the website). Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "review-queue-read");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await reviewQueueForApi(prisma, authorized.auth.user.id), { headers: NO_STORE });
}
