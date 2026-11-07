import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { saveSearchFromApi, serializeSavedSearches } from "@/lib/api-v1/search";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/saved-searches — the searches kept on the website's Search page, by name, each with
 * its filters (as `GET /api/v1/search` takes them) and what it finds now. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "search");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await serializeSavedSearches(prisma, authorized.auth.user), { headers: NO_STORE });
}

/**
 * POST /api/v1/saved-searches `{ name, q?, type?, accountId?, categoryId?, tagId? }` — keeps a
 * search under a name, as "Save this search" does; at least one filter, up to 50 searches.
 * 201 `{ id }`. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "search-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await saveSearchFromApi(prisma, authorized.auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { status: 201, headers: NO_STORE });
}
