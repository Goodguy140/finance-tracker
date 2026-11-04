import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseRestoreBody } from "@/lib/api-v1/insights";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { restoreInsight } from "@/lib/insights/dismiss";

export const dynamic = "force-dynamic";

/** POST /api/v1/insights/restore — `{ "key" }` lists a dismissed or snoozed insight again. Scope `app`. */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "insights-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseRestoreBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);
  await restoreInsight(authorized.auth.user.id, parsed.value.key);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
