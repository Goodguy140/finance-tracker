import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { parsePairBody } from "@/lib/api-v1/review-queue";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { pairStagedTransfers, ReviewDecisionError } from "@/lib/plaid/review-decisions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/review-queue/pair with `{ id, peerId }` — adds two bank rows as the two legs of
 * one transfer (the row's `transferPair`). Answers the two entries; 409 with the reason when
 * they cannot be one transfer. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "review-queue-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parsePairBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  let transactionIds: [string, string];
  try {
    transactionIds = await pairStagedTransfers(auth.user.id, parsed.value.id, parsed.value.peerId);
  } catch (err) {
    if (err instanceof ReviewDecisionError) return apiError(err.message, 409);
    throw err;
  }

  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.plaid_transactions_committed,
    metadata: { tokenId: auth.token.id, via: "app", decision: "pair", transactionIds },
    headers: await headers(),
  });
  return NextResponse.json({ transactionIds }, { headers: NO_STORE });
}
