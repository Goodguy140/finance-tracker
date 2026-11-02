import { NextResponse } from "next/server";
import { APP_REDIRECT_URI } from "@/lib/app-devices";

/**
 * GET /api/v1/server — public. The phone app calls it with the address someone typed in, to
 * check it is a Finance Tracker server before opening the sign-in sheet. It names the
 * sign-in endpoints and nothing else: no version, users or settings, for the same reason
 * `/api/health` tells anonymous callers only that it is up.
 */
export function GET() {
  return NextResponse.json(
    {
      service: "finance-tracker",
      api: 1,
      appSignIn: {
        authorizePath: "/app/authorize",
        tokenPath: "/api/v1/app/token",
        revokePath: "/api/v1/app/revoke",
        redirectUri: APP_REDIRECT_URI,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
