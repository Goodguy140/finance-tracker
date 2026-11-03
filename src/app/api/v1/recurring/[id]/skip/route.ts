import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { API_SCOPES } from "@/lib/api-token";
import { parseSkipBody } from "@/lib/api-v1/recurring";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { dateFromYmd } from "@/lib/date-only";
import { prisma } from "@/lib/prisma";
import { isOccurrenceRace, RecurringOccurrenceError } from "@/lib/recurring-post";
import { skipRecurringOccurrence } from "@/lib/recurring-skip";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/recurring/:id/skip — moves the rule past the occurrence `{ "expectedDate" }`
 * without posting it, as the website's Skip does. `"reason": "already_logged"` first links the
 * entry the person logged themselves (same name, within 15 days). 409 with the reason when the
 * rule has moved to another date or is off; 404 for a rule that is not the user's. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseSkipBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);

  const recurringTransactionId = (await params).id;
  try {
    await prisma.$transaction((tx) =>
      skipRecurringOccurrence(tx, {
        userId: auth.user.id,
        recurringTransactionId,
        expectedDate: dateFromYmd(parsed.value.expectedDate),
        reason: parsed.value.reason,
      }),
    );
  } catch (err) {
    if (err instanceof RecurringOccurrenceError) return apiError(err.message, err.notFound ? 404 : 409);
    // Another posted entry already owns that date: the occurrence is settled either way.
    if (!isOccurrenceRace(err)) throw err;
  }

  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.api_recurring_skipped,
    targetType: "recurring_transaction",
    targetId: recurringTransactionId,
    metadata: { tokenId: auth.token.id, via: auth.token.kind === "device" ? "app" : "api", expectedDate: parsed.value.expectedDate, reason: parsed.value.reason },
    headers: await headers(),
  });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
