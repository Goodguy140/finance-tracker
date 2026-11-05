import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/api-v1/route-auth";
import { clientIpFromForwardingHeaders } from "@/lib/client-ip";
import { enforceSlidingWindowRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { createAuthenticationOptions } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

/** As the login page's `beginPasswordlessSignInAction`, under the same key. */
const PASSKEY_SIGNIN_MAX_PER_IP = 20;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/v1/app/passkey/options — public. Starts a passkey sign-in for the phone app: a
 * single-use challenge, as the login page gets. The app passes the options to iOS, which offers
 * the person's passkeys for this domain behind Face ID (`src/lib/app-passkey-sign-in.ts`).
 */
export async function POST(request: Request) {
  const ip = clientIpFromForwardingHeaders(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"));
  try {
    if (ip) {
      await enforceSlidingWindowRateLimit(`passkey-signin-ip:${ip}`, PASSKEY_SIGNIN_MAX_PER_IP, WINDOW_MS, "Rate limit exceeded.");
    }
  } catch (err) {
    if (!(err instanceof RateLimitExceededError)) throw err;
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again shortly." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }
  const { challengeId, options } = await createAuthenticationOptions("signin", null);
  return NextResponse.json({ challengeId, options }, { headers: NO_STORE });
}
