import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/api-v1/route-auth";
import { signInAppWithPasskey } from "@/lib/app-passkey-sign-in";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { clientIpFromForwardingHeaders } from "@/lib/client-ip";
import { prisma } from "@/lib/prisma";
import { enforceSlidingWindowRateLimit, RateLimitExceededError } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** As the login page's passkey provider (`auth-options.ts`), under the same key. */
const PASSKEY_MAX_PER_IP = 20;
const WINDOW_MS = 15 * 60 * 1000;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * POST /api/v1/app/passkey/token — public; the passkey is the credential.
 *   { challengeId, response: AuthenticationResponseJSON, device_name, platform?, app_version? }
 * Answers as `POST /api/v1/app/token` does: a device token for this phone.
 */
export async function POST(request: Request) {
  const ip = clientIpFromForwardingHeaders(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"));
  try {
    if (ip) await enforceSlidingWindowRateLimit(`passkey-ip:${ip}`, PASSKEY_MAX_PER_IP, WINDOW_MS, "Rate limit exceeded.");
  } catch (err) {
    if (!(err instanceof RateLimitExceededError)) throw err;
    return NextResponse.json(
      { error: "slow_down", error_description: "Too many sign-in attempts. Try again shortly." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Send the passkey response as JSON." },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await signInAppWithPasskey({
    challengeId: str(body.challengeId) ?? "",
    response: body.response,
    deviceName: str(body.device_name) ?? "",
    platform: str(body.platform),
    appVersion: str(body.app_version),
  });
  if (!result.ok) {
    if (result.user?.disabledAt) {
      await recordAuditLog(prisma, {
        userId: result.user.id,
        action: AUDIT_ACTIONS.user_login_failed,
        metadata: { email: result.user.email, reason: "account_disabled", via: "app-passkey" },
        headers: request.headers,
      });
    }
    return NextResponse.json(
      { error: result.status === 403 ? "access_denied" : "invalid_grant", error_description: result.error },
      { status: result.status, headers: NO_STORE },
    );
  }

  await recordAuditLog(prisma, {
    userId: result.user.id,
    action: AUDIT_ACTIONS.mfa_verified,
    metadata: { method: "passkey-signin", via: "app" },
    headers: request.headers,
  });
  await recordAuditLog(prisma, {
    userId: result.user.id,
    action: AUDIT_ACTIONS.app_device_signed_in,
    targetType: "app_device",
    targetId: result.device.id,
    metadata: { name: result.device.name, platform: result.device.platform, appVersion: result.device.appVersion, method: "passkey" },
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
