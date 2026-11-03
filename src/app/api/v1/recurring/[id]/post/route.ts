import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { parsePostBody } from "@/lib/api-v1/recurring";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { dateFromYmd } from "@/lib/date-only";
import { prisma } from "@/lib/prisma";
import { isOccurrenceRace, postRecurringOccurrence, RecurringOccurrenceError, type PostOutcome } from "@/lib/recurring-post";
import { emitTransactionsCreated } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/recurring/:id/post — posts the occurrence `{ "expectedDate": "YYYY-MM-DD" }` as the
 * website's Post button does, and moves the rule on to the next one. Answers `{ outcome,
 * transactionId }`: `posted` with the new entry, or `already_posted` when it was posted before
 * (a retry, or two taps racing), which is not an error. 409 with the reason when it cannot be
 * posted (the rule has moved to another date, is off, past its end date, or its account is
 * archived); 404 for a rule that is not the user's. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parsePostBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const recurringTransactionId = (await params).id;
  let transactionId: string | null = null;
  let outcome: PostOutcome;
  try {
    outcome = await prisma.$transaction((tx) =>
      postRecurringOccurrence(tx, {
        userId: auth.user.id,
        recurringTransactionId,
        expectedDate: dateFromYmd(parsed.value.expectedDate),
        onPosted: (id) => {
          transactionId = id;
        },
      }),
    );
  } catch (err) {
    if (err instanceof RecurringOccurrenceError) return apiError(err.message, err.notFound ? 404 : 409);
    if (!isOccurrenceRace(err)) throw err;
    outcome = "already_posted";
  }

  if (outcome !== "posted" || !transactionId) {
    // `no_change`: another request moved the rule between the read and the write; it posted it.
    return NextResponse.json({ outcome: "already_posted", transactionId: null }, { headers: NO_STORE });
  }

  emitTransactionsCreated(auth.user.id, [transactionId], "manual");
  // As the website's Post does; it only sends anything when a budget has gone over.
  scheduleBudgetAlertEmails(auth.user.id);
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_recurring_posted,
    targetType: "transaction",
    targetId: transactionId,
    metadata: { tokenId: auth.token.id, via: auth.token.kind === "device" ? "app" : "api", recurringTransactionId, expectedDate: parsed.value.expectedDate },
    headers: await headers(),
  });
  return NextResponse.json({ outcome: "posted", transactionId }, { status: 201, headers: NO_STORE });
}
