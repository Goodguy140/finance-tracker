import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { PlanError, recordPlannedTransaction } from "@/lib/planned-transactions-record";
import { prisma } from "@/lib/prisma";
import { emitTransactionsCreated } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/planned/:id/record `{ "date"?: "YYYY-MM-DD" }` — "Yes, add it": the plan becomes an
 * entry in the log, on the plan's date unless another is given, and is marked done. 201 with the
 * entry's `transactionId`; 409 when it has already happened or its account is archived. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "planned-write");
  if (!authorized.ok) return authorized.response;
  const { user, token } = authorized.auth;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const date = read.body && typeof read.body === "object" && "date" in read.body ? (read.body as { date: unknown }).date : null;
  if (date !== null && date !== undefined && typeof date !== "string") return apiError("'date' must be YYYY-MM-DD.", 400);

  try {
    const planId = (await params).id;
    const { transactionId, type } = await recordPlannedTransaction(prisma, user.id, planId, date);
    emitTransactionsCreated(user.id, [transactionId], "manual");
    if (type === TransactionType.EXPENSE) scheduleBudgetAlertEmails(user.id);
    // It adds an entry to the log, as POST /api/v1/transactions does, so it is recorded the same way.
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.api_plan_recorded,
      targetType: "transaction",
      targetId: transactionId,
      metadata: { tokenId: token.id, via: token.kind === "device" ? "app" : "api", plannedTransactionId: planId },
      headers: await headers(),
    });
    return NextResponse.json({ transactionId }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof PlanError) return apiError(err.message, err.notFound ? 404 : 409);
    throw err;
  }
}
