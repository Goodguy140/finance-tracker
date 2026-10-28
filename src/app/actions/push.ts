"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  describePushDevice,
  MAX_PUSH_DEVICES,
  PUSH_ALERT_KINDS,
  sendPushToUser,
  type PushAlertKind,
} from "@/lib/push-notifications";
import { requireUser } from "@/lib/session";
import { isAllowedPushEndpoint } from "@/lib/web-push";
import { formAction, formActionWithResult, getFormValue } from "./_helpers";

/**
 * Saves this browser's push subscription (`PushManager.subscribe`). Resubscribing the same
 * browser keeps its choices; an endpoint that belongs to another account moves to this one,
 * since only one person can be signed in on that browser at a time.
 */
export const savePushDeviceAction = formActionWithResult(async (formData: FormData) => {
  const user = await requireUser();
  const endpoint = getFormValue(formData, "endpoint");
  const p256dh = getFormValue(formData, "p256dh");
  const auth = getFormValue(formData, "auth");
  if (!isAllowedPushEndpoint(endpoint)) throw new Error("This browser's push service is not supported.");
  if (Buffer.from(p256dh, "base64url").length !== 65 || Buffer.from(auth, "base64url").length !== 16) {
    throw new Error("The browser sent an invalid subscription.");
  }
  const existing = await prisma.pushDevice.findUnique({ where: { endpoint }, select: { userId: true } });
  if (existing?.userId !== user.id && (await prisma.pushDevice.count({ where: { userId: user.id } })) >= MAX_PUSH_DEVICES) {
    throw new Error(`Up to ${MAX_PUSH_DEVICES} devices. Remove one you no longer use first.`);
  }
  const label = describePushDevice((await headers()).get("user-agent") ?? "");
  const device = await prisma.pushDevice.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh, auth, label },
    update: { userId: user.id, p256dh, auth, label, failureCount: 0 },
    select: { id: true },
  });
  revalidatePath("/settings/notifications");
  return { ok: true as const, deviceId: device.id };
});

async function ownDevice(userId: string, formData: FormData) {
  const device = await prisma.pushDevice.findFirst({
    where: { id: getFormValue(formData, "deviceId"), userId },
    select: { id: true },
  });
  if (!device) throw new Error("That device is no longer set up. Reload the page.");
  return device;
}

/** Which alerts go to one device. */
export const updatePushDeviceAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const device = await ownDevice(user.id, formData);
  const data = Object.fromEntries(
    PUSH_ALERT_KINDS.map((kind) => [kind, formData.get(kind) === "true"]),
  ) as Record<PushAlertKind, boolean>;
  await prisma.pushDevice.update({ where: { id: device.id }, data });
  revalidatePath("/settings/notifications");
});

export const removePushDeviceAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const device = await ownDevice(user.id, formData);
  await prisma.pushDevice.delete({ where: { id: device.id } });
  revalidatePath("/settings/notifications");
});

/** A test notification to one device, so the person sees it work before relying on it. */
export const sendTestPushAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const device = await ownDevice(user.id, formData);
  const result = await sendPushToUser(
    user.id,
    null,
    { title: "Finance Tracker", body: "Notifications are working on this device.", url: "/settings/notifications", tag: "test" },
    { deviceId: device.id },
  );
  revalidatePath("/settings/notifications");
  if (result.delivered === 0) throw new Error("The push service did not accept the notification. Try turning it off and on again.");
});
