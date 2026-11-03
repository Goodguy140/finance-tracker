import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { appPushStatus, parsePushRegistration, registerAppPush } from "@/lib/api-v1/app-push";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Only a signed-in phone has alerts to register; scope `app` already means a device token. */
async function phone(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "app-push");
  if (!authorized.ok) return authorized;
  const { user, token } = authorized.auth;
  if (token.kind !== "device") return { ok: false as const, response: apiError("Only the phone app registers for alerts.", 403) };
  return { ok: true as const, device: { id: token.id, userId: user.id } };
}

/**
 * GET /api/v1/app/device/push — this phone's alert settings (`registration`, null until it
 * registers) and whether the server can send alerts at all (`available`: an admin has saved
 * Apple's push key).
 */
export async function GET(request: Request) {
  const auth = await phone(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await appPushStatus(prisma, auth.device.id), { headers: NO_STORE });
}

/**
 * PUT /api/v1/app/device/push with `{ token, environment?, alerts?: { billReminders?,
 * chargeAlerts?, budgetAlerts? }, hideAmounts? }` — registers this phone's APNs token, or
 * changes its switches. Answers the registration as saved.
 */
export async function PUT(request: Request) {
  const auth = await phone(request);
  if (!auth.ok) return auth.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parsePushRegistration(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const registration = await registerAppPush(prisma, auth.device, parsed.value);
  return NextResponse.json({ registration }, { headers: NO_STORE });
}

/** DELETE /api/v1/app/device/push — this phone stops getting alerts. Signing out does the same. */
export async function DELETE(request: Request) {
  const auth = await phone(request);
  if (!auth.ok) return auth.response;
  await prisma.appPushToken.deleteMany({ where: { appDeviceId: auth.device.id } });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
