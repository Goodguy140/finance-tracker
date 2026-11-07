import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { loadRuleSuggestions } from "@/lib/api-v1/transaction-rules";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/rules/suggestions — Settings → Rules' learned Title → Category combos that are not
 * hidden and that no rule decides yet, the most recently used first: `{ total, suggestions }`.
 * Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "rules");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadRuleSuggestions(prisma, authorized.auth.user.id), { headers: NO_STORE });
}
