import { NextResponse } from "next/server";
import { parseBearerToken } from "@/lib/api-token";
import { NO_STORE } from "@/lib/api-v1/route-auth";
import { revokeAppDeviceToken } from "@/lib/app-devices";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/app/revoke with `Authorization: Bearer ftd_…`: the phone app's "Sign out".
 * Always 200, as RFC 7009 has it: an unknown or already-ended token is already signed out,
 * and saying which it was would only help someone guessing.
 */
export async function POST(request: Request) {
  const raw = parseBearerToken(request.headers.get("authorization"));
  const device = raw ? await revokeAppDeviceToken(raw) : null;
  if (device) {
    await recordAuditLog(prisma, {
      userId: device.userId,
      action: AUDIT_ACTIONS.app_device_signed_out,
      targetType: "app_device",
      targetId: device.id,
      metadata: { name: device.name, by: "app" },
      headers: request.headers,
    });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
