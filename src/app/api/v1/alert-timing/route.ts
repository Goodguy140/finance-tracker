import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { patchAlertTimingFromApi, serializeAlertTiming } from "@/lib/api-v1/alert-timing";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/alert-timing — when the alerts come, as Settings → Notifications has it:
 * `billReminderDays` (1, 3 or 7 days before, or null for off), `chargeThresholdCents` (null: no
 * large-charge check) and `chargeUnusual`, `digest` (off, weekly or monthly) and `budgetAlertEmail`,
 * with `emailAvailable` saying whether the server can send email at all. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "alert-timing");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await serializeAlertTiming(prisma, authorized.auth.user.id), { headers: NO_STORE });
}

/**
 * PATCH /api/v1/alert-timing — any of the fields above, with Settings → Notifications' checks
 * (a reminder or charge alert needs email or a phone that takes it; the digest and budget emails
 * need email). 400 with the reason; 200 with the settings as they now are. Scope `app`.
 */
export async function PATCH(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "alert-timing-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await patchAlertTimingFromApi(prisma, authorized.auth.user, read.body);
  if (!result.ok) return apiError(result.error, 400);
  return NextResponse.json(await serializeAlertTiming(prisma, authorized.auth.user.id), { headers: NO_STORE });
}
