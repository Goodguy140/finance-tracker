import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { homeCurrencyOf } from "@/lib/home-currency";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/me — who the phone app is signed in as, and the settings it formats with.
 * Scope `app`, which only device tokens hold: a personal access token gets 403.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "me");
  if (!authorized.ok) return authorized.response;
  const { user, token } = authorized.auth;
  return NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        timezone: user.timezone,
        countryCode: user.countryCode,
        currency: homeCurrencyOf(user.countryCode),
      },
      device: { id: token.id },
      // What this server takes from the phone beyond the first API, so the app can offer it: each
      // later addition that has no other sign names itself here.
      features: ["rules", "goals", "search", "forecast", "calendar", "alert-timing"],
    },
    { headers: NO_STORE },
  );
}
