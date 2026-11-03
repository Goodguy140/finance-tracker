import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { parseDecisionBody } from "@/lib/api-v1/review-queue";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { decideStagedRow, ReviewDecisionError } from "@/lib/plaid/review-decisions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/review-queue/:id — decides one bank row, as the website's queue buttons do:
 * `{ "decision": "add" }` (with `countAs` to book it as expense, income or transfer instead,
 * and `categoryId` to override the proposed category), `{ "decision": "link", "transactionId" }`
 * or `{ "decision": "ignore" }`. Answers the entry it was booked as (null when ignored); 409
 * with the reason when it cannot be done, such as a row already decided elsewhere. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "review-queue-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseDecisionBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const stagedId = (await params).id;
  let transactionId: string | null;
  try {
    ({ transactionId } = await decideStagedRow(auth.user.id, stagedId, parsed.value));
  } catch (err) {
    if (err instanceof ReviewDecisionError) return apiError(err.message, 409);
    throw err;
  }

  if (parsed.value.decision !== "ignore") {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.plaid_transactions_committed,
      targetType: "transaction",
      targetId: transactionId,
      metadata: { tokenId: auth.token.id, via: "app", decision: parsed.value.decision, stagedId },
      headers: await headers(),
    });
  }
  return NextResponse.json({ transactionId }, { headers: NO_STORE });
}
