import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { serializeMerchant } from "@/lib/api-v1/category-merchant";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { loadMerchantActivity } from "@/lib/reports/category-merchant-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/merchants?key= — the website's payee page: everything from one payee across all
 * history, by the key a category trend's payees carry. 404 when nothing matches. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "merchant");
  if (!authorized.ok) return authorized.response;
  const key = new URL(request.url).searchParams.get("key")?.trim();
  if (!key) return apiError("Name a payee.", 400);
  const loaded = await loadMerchantActivity(authorized.auth.user, key);
  if (!loaded) return apiError("Nothing from that payee.", 404);
  return NextResponse.json(serializeMerchant(loaded), { headers: NO_STORE });
}
