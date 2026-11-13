import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { patchSafeToSpendSettingsFromApi, serializeSafeToSpendSettings } from "@/lib/api-v1/safe-to-spend";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/safe-to-spend — Safe to spend's buffer as the website's card has it: `bufferDays`
 * (bills due this many days ahead are held back when they fall next month; null for none) and
 * `maxBufferDays`, with `safeToSpend` worked out as the Home screen shows it. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "safe-to-spend");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await serializeSafeToSpendSettings(prisma, authorized.auth.user), { headers: NO_STORE });
}

/**
 * PATCH /api/v1/safe-to-spend — `{ "bufferDays": 7 }`, or null to turn the buffer off. 400 with
 * the reason; 200 with the settings and the number as they now are. Scope `app`.
 */
export async function PATCH(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "safe-to-spend-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await patchSafeToSpendSettingsFromApi(prisma, authorized.auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, 400);
  return NextResponse.json(await serializeSafeToSpendSettings(prisma, authorized.auth.user), { headers: NO_STORE });
}
