import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/api-v1/route-auth";
import { APP_REDIRECT_URI, exchangeAppSignInCode } from "@/lib/app-devices";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { clientIpFromForwardingHeaders } from "@/lib/client-ip";
import { prisma } from "@/lib/prisma";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";

// No session and no bearer token yet: the one-time code and its PKCE verifier are the credential.
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** OAuth token endpoints take a form body; JSON is accepted too, as every other `/api/v1` route does. */
async function readParams(request: Request): Promise<Record<string, string> | null> {
  try {
    if ((request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(await request.text()));
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return Object.fromEntries(Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return null;
  }
}

function oauthError(error: string, description: string, status: number) {
  return NextResponse.json({ error, error_description: description }, { status, headers: NO_STORE });
}

/**
 * POST /api/v1/app/token
 *   grant_type=authorization_code&code=…&code_verifier=…[&redirect_uri=financetracker://signed-in]
 *   [&platform=ios&app_version=1.0.0]
 * Trades the code `/app/authorize` handed the phone app for a device token (`src/lib/app-devices.ts`).
 */
export async function POST(request: Request) {
  const ip = clientIpFromForwardingHeaders(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"));
  try {
    await enforceSlidingWindowRateLimit(`app-token:${ip ?? "unknown"}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, "Rate limit exceeded.");
  } catch {
    return NextResponse.json(
      { error: "slow_down", error_description: "Too many sign-in attempts. Try again shortly." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }

  const params = await readParams(request);
  if (!params) return oauthError("invalid_request", "Send the code and code_verifier as a form or JSON body.", 400);
  if ((params.grant_type ?? "authorization_code") !== "authorization_code") {
    return oauthError("unsupported_grant_type", "Only authorization_code is supported.", 400);
  }
  if (params.redirect_uri !== undefined && params.redirect_uri !== APP_REDIRECT_URI) {
    return oauthError("invalid_grant", "The redirect_uri does not match.", 400);
  }

  const result = await exchangeAppSignInCode({
    code: params.code ?? "",
    codeVerifier: params.code_verifier ?? "",
    platform: params.platform,
    appVersion: params.app_version,
  });
  if (!result.ok) return oauthError(result.status === 403 ? "access_denied" : "invalid_grant", result.error, result.status);

  await recordAuditLog(prisma, {
    userId: result.user.id,
    action: AUDIT_ACTIONS.app_device_signed_in,
    targetType: "app_device",
    targetId: result.device.id,
    metadata: { name: result.device.name, platform: result.device.platform, appVersion: result.device.appVersion },
    headers: request.headers,
  });

  return NextResponse.json(
    {
      access_token: result.token,
      token_type: "Bearer",
      device: { id: result.device.id, name: result.device.name },
      user: { id: result.user.id, email: result.user.email, displayName: result.user.displayName },
    },
    { headers: NO_STORE },
  );
}
