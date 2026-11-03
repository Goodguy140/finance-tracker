import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseDismissBody } from "@/lib/api-v1/insights";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { dismissInsight } from "@/lib/insights/dismiss";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/insights/dismiss — `{ "key", "mode" }` hides an insight for 30 days (`snooze`) or
 * for good (`forever`, the default), as the website's Snooze and Dismiss do. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "insights-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseDismissBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);
  await dismissInsight(authorized.auth.user, parsed.value.key, parsed.value.mode);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
