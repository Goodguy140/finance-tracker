import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { parseBulkBody } from "@/lib/api-v1/review-queue";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { addStagedRows, ignoreStagedRows, linkStagedRows, ReviewDecisionError } from "@/lib/plaid/review-decisions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/review-queue/bulk — several rows in one step, all or none:
 * `{ "action": "add", "ids": [...] }` ("Add all"; with `categoryId`, each in that category),
 * `{ "action": "ignore", "ids": [...] }`, or `{ "action": "link", "links": [{ id, transactionId }] }`
 * ("Link all strong matches"). 409 with the reason when any row cannot be done. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "review-queue-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseBulkBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const bulk = parsed.value;

  let committed: number | null = null;
  try {
    if (bulk.action === "add") committed = await addStagedRows(auth.user.id, bulk.ids, bulk.categoryId);
    else if (bulk.action === "ignore") await ignoreStagedRows(auth.user.id, bulk.ids);
    else {
      await linkStagedRows(auth.user.id, bulk.links);
      committed = bulk.links.length;
    }
  } catch (err) {
    if (err instanceof ReviewDecisionError) return apiError(err.message, 409);
    throw err;
  }

  if (committed !== null) {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.plaid_transactions_committed,
      metadata: { tokenId: auth.token.id, via: "app", decision: bulk.action, count: committed },
      headers: await headers(),
    });
  }
  return NextResponse.json({ ok: true, ...(bulk.action === "add" ? { added: committed } : {}) }, { headers: NO_STORE });
}
