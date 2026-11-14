import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseTrackHabitBody } from "@/lib/api-v1/insights";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { loadInsights } from "@/lib/insights/load";
import { fileHabitSeparately, habitMerchants } from "@/lib/insights/track-habit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/insights/track-habit `{ "habit" }` — the website's "Track separately" on a habit
 * insight: a category of its own and a rule for each merchant, ahead of every other rule. Past
 * entries stay where they are. Answers `{ categoryId, categoryName, rulesAdded }`; 409 when there
 * is nothing to track or the rules are full. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "insights-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parseTrackHabitBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const { user } = authorized.auth;
  const found = habitMerchants(await loadInsights(user.id, user.countryCode, user.timezone), parsed.value.habit);
  if (!found.ok) return apiError(found.error, 409);
  try {
    return NextResponse.json(await fileHabitSeparately(prisma, user.id, parsed.value.habit, found.merchants), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("You can have up to")) return apiError(err.message, 409);
    throw err;
  }
}
