import { Prisma, type PrismaClient } from "@prisma/client";
import { encryptSecret, tryDecryptSecret } from "@/lib/security";
import { sendEmail } from "@/lib/email";
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PushAlertKind } from "@/lib/push-notifications-shared";
import { generateVapidKeys, sendWebPush, type VapidKeys } from "@/lib/web-push";

/**
 * Phone notifications (Web Push) next to the alert emails. A device opts in to each alert kind
 * on its own; the alert's own setting (how many days before a bill, the charge threshold) still
 * decides whether anything is due. `deliverAlert` is the one place an alert goes out, so email
 * and push succeed or fail together as far as the caller's "sent" bookkeeping is concerned.
 */

export { PUSH_ALERT_KINDS, PUSH_ALERT_LABELS, type PushAlertKind } from "@/lib/push-notifications-shared";

/** Devices per user; an old phone that was never turned off still takes a slot. */
export const MAX_PUSH_DEVICES = 10;
/** A device that has failed this many sends in a row is dropped rather than retried forever. */
const MAX_FAILURES = 10;

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

const VAPID_PUBLIC = "push.vapidPublicKey";
const VAPID_PRIVATE = "push.vapidPrivateKey";

/**
 * The server's VAPID key pair, made on first use and kept (encrypted) in `ServerSetting`.
 * Browsers bind each subscription to the public key, so it must never change while devices
 * are subscribed. Two first requests racing both try to create the rows; the loser reads the
 * winner's.
 */
export async function getVapidKeys(client: PrismaClient = defaultPrisma): Promise<VapidKeys> {
  const read = async (): Promise<VapidKeys | null> => {
    const rows = await client.serverSetting.findMany({ where: { key: { in: [VAPID_PUBLIC, VAPID_PRIVATE] } } });
    const publicKey = rows.find((r) => r.key === VAPID_PUBLIC);
    const privateKey = rows.find((r) => r.key === VAPID_PRIVATE);
    if (!publicKey || !privateKey) return null;
    const pub = tryDecryptSecret(publicKey.encryptedValue);
    const priv = tryDecryptSecret(privateKey.encryptedValue);
    return pub && priv ? { publicKey: pub, privateKey: priv } : null;
  };
  const existing = await read();
  if (existing) return existing;

  const keyRows = { key: { in: [VAPID_PUBLIC, VAPID_PRIVATE] } };
  if ((await client.serverSetting.count({ where: keyRows })) > 0) {
    // A pair left unreadable by a rotated encryption key is replaced. Its subscriptions are
    // bound to the old public key and can never be sent to again, so they go too.
    await client.$transaction([client.serverSetting.deleteMany({ where: keyRows }), client.pushDevice.deleteMany({})]);
  }
  const fresh = generateVapidKeys();
  try {
    await client.$transaction([
      client.serverSetting.create({ data: { key: VAPID_PUBLIC, encryptedValue: encryptSecret(fresh.publicKey) } }),
      client.serverSetting.create({ data: { key: VAPID_PRIVATE, encryptedValue: encryptSecret(fresh.privateKey) } }),
    ]);
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const stored = await read();
  if (!stored) throw new Error("Could not set up push notification keys.");
  return stored;
}

/** Who the push services contact about abuse; Apple rejects tokens without a usable one. */
export function vapidSubject(env: Record<string, string | undefined> = process.env): string {
  const base = env.NEXTAUTH_URL?.trim();
  if (base) {
    try {
      const url = new URL(base);
      if (url.protocol === "https:") return url.origin;
    } catch {
      // fall through
    }
  }
  const from = env.SMTP_FROM?.match(/[^\s<>]+@[^\s<>]+/)?.[0];
  return `mailto:${from ?? "admin@localhost.localdomain"}`;
}

export type PushSender = typeof sendWebPush;

/**
 * Sends to each of the user's devices that has `kind` on. Returns how many received it. A
 * device the push service says is gone is deleted; one that keeps failing is deleted after
 * `MAX_FAILURES` sends in a row.
 */
export async function sendPushToUser(
  userId: string,
  kind: PushAlertKind | null,
  message: PushMessage,
  deps: { client?: PrismaClient; send?: PushSender; deviceId?: string } = {},
): Promise<{ devices: number; delivered: number }> {
  const client = deps.client ?? defaultPrisma;
  const devices = await client.pushDevice.findMany({
    where: { userId, ...(kind ? { [kind]: true } : {}), ...(deps.deviceId ? { id: deps.deviceId } : {}) },
    select: { id: true, endpoint: true, p256dh: true, auth: true, failureCount: true },
  });
  if (devices.length === 0) return { devices: 0, delivered: 0 };
  const vapid = { keys: await getVapidKeys(client), subject: vapidSubject() };
  const send = deps.send ?? sendWebPush;
  const payload = JSON.stringify({ ...message, url: message.url ?? "/" });
  let delivered = 0;
  for (const device of devices) {
    const result = await send(device, payload, vapid);
    if (result.ok) {
      delivered += 1;
      await client.pushDevice.update({ where: { id: device.id }, data: { lastSentAt: new Date(), failureCount: 0 } });
    } else if (result.gone || device.failureCount + 1 >= MAX_FAILURES) {
      await client.pushDevice.deleteMany({ where: { id: device.id } });
    } else {
      console.error(`[push] sending to a device failed: ${result.error}`);
      await client.pushDevice.update({ where: { id: device.id }, data: { failureCount: { increment: 1 } } });
    }
  }
  return { devices: devices.length, delivered };
}

/** Whether any user has a phone set up for `kind`, so a sweep has a reason to run without SMTP. */
export async function anyPushDevices(kind: PushAlertKind, client: PrismaClient = defaultPrisma): Promise<boolean> {
  return (await client.pushDevice.count({ where: { [kind]: true } })) > 0;
}

/** Whether one of this user's devices has `kind` on. */
export async function hasPushDeviceFor(
  userId: string,
  kind: PushAlertKind,
  client: PrismaClient = defaultPrisma,
): Promise<boolean> {
  return (await client.pushDevice.count({ where: { userId, [kind]: true } })) > 0;
}

export type DeliveryOutcome = "sent" | "failed" | "no-channel";

/**
 * Sends one alert by email and to the user's phones. "sent" when either reached the person, so
 * the caller marks it done; "failed" when a channel was there but nothing got through, so the
 * caller leaves it for the next try; "no-channel" when there was nowhere to send it.
 */
export async function deliverAlert(
  alert: { userId: string; to: string | null; kind: PushAlertKind; subject: string; text: string; push: PushMessage },
  deps: { client?: PrismaClient; send?: typeof sendEmail; push?: PushSender } = {},
): Promise<DeliveryOutcome> {
  let emailSent = false;
  let emailAttempted = false;
  if (alert.to) {
    try {
      const result = await (deps.send ?? sendEmail)({ to: alert.to, subject: alert.subject, text: alert.text });
      emailSent = result.sent;
      emailAttempted = result.sent || result.reason !== "SMTP not configured";
    } catch (err) {
      emailAttempted = true;
      console.error(`[alerts] emailing "${alert.subject}" failed`, err);
    }
  }
  let pushed = { devices: 0, delivered: 0 };
  try {
    pushed = await sendPushToUser(alert.userId, alert.kind, alert.push, { client: deps.client, send: deps.push });
  } catch (err) {
    pushed = { devices: 1, delivered: 0 };
    console.error(`[alerts] push for "${alert.subject}" failed`, err);
  }
  if (emailSent || pushed.delivered > 0) return "sent";
  return emailAttempted || pushed.devices > 0 ? "failed" : "no-channel";
}

/** A name for the device subscribing, from its user agent. */
export function describePushDevice(userAgent: string): string {
  const ua = userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Linux|CrOS/.test(ua)
              ? "Linux"
              : "Device";
  // Order matters: Edge and Opera also say Chrome, and Chrome also says Safari.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  if (device === "iPhone" || device === "iPad") return device;
  return browser ? `${browser} on ${device}` : device;
}
