import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseRevisionBody } from "@/lib/api-v1/review-queue";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { applyStagedRevision, dismissStagedRevision, ReviewDecisionError } from "@/lib/plaid/review-decisions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/review-queue/revisions/:id with `{ "action": "apply" }` (take the bank's revised
 * amount for the entry already added) or `{ "action": "dismiss" }` (keep yours). Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "review-queue-write");
  if (!authorized.ok) return authorized.response;
  const userId = authorized.auth.user.id;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseRevisionBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const stagedId = (await params).id;
  try {
    if (parsed.value === "apply") await applyStagedRevision(userId, stagedId);
    else await dismissStagedRevision(userId, stagedId);
  } catch (err) {
    if (err instanceof ReviewDecisionError) return apiError(err.message, 409);
    throw err;
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
