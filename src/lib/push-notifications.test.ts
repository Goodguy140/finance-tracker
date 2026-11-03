import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApnsSender } from "@/lib/apns";
import { encryptSecret } from "@/lib/security";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "push-"));
const url = `file:${join(dir, "push.db")}`;
let db: PrismaClient;
let push: typeof import("./push-notifications");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  push = await import("./push-notifications");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `p${seq}@example.test`, displayName: "Test" } })).id;
});

function device(name: string, extra: Record<string, unknown> = {}) {
  return db.pushDevice.create({
    data: { userId, endpoint: `https://fcm.googleapis.com/fcm/send/${seq}-${name}`, p256dh: "k", auth: "a", label: name, ...extra },
  });
}

const message = { title: "Hydro is due tomorrow", body: "Tomorrow: Hydro $80.00" };

describe("getVapidKeys", () => {
  it("makes one key pair and keeps it", async () => {
    const first = await push.getVapidKeys(db);
    expect(Buffer.from(first.publicKey, "base64url")).toHaveLength(65);
    expect(await push.getVapidKeys(db)).toEqual(first);
    const stored = await db.serverSetting.findUniqueOrThrow({ where: { key: "push.vapidPrivateKey" } });
    expect(stored.encryptedValue).not.toContain(first.privateKey);
  });
});

describe("sendPushToUser", () => {
  it("sends only to devices that have the alert on, and drops one the push service says is gone", async () => {
    const phone = await device("phone");
    const laptop = await device("laptop", { billReminders: false });
    const old = await device("old");
    const send = vi.fn(async (target: { endpoint: string }) =>
      target.endpoint.endsWith("-old") ? { ok: false as const, gone: true, status: 410, error: "gone" } : { ok: true as const },
    );
    expect(await push.sendPushToUser(userId, "billReminders", message, { client: db, send })).toEqual({ devices: 2, delivered: 1 });
    expect(send.mock.calls.map(([target]) => target.endpoint)).not.toContain(laptop.endpoint);
    expect(await db.pushDevice.findUnique({ where: { id: old.id } })).toBeNull();
    expect((await db.pushDevice.findUniqueOrThrow({ where: { id: phone.id } })).lastSentAt).not.toBeNull();
    expect(JSON.parse((send.mock.calls[0] as unknown as [unknown, string])[1])).toEqual({ ...message, url: "/" });
  });

  it("counts failures in a row and gives up on a device after ten", async () => {
    const phone = await device("phone", { failureCount: 8 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => ({ ok: false as const, gone: false, status: 500, error: "busy" }));
    await push.sendPushToUser(userId, "budgetAlerts", message, { client: db, send });
    expect((await db.pushDevice.findUniqueOrThrow({ where: { id: phone.id } })).failureCount).toBe(9);
    await push.sendPushToUser(userId, "budgetAlerts", message, { client: db, send });
    expect(await db.pushDevice.findUnique({ where: { id: phone.id } })).toBeNull();
    errorSpy.mockRestore();
  });
});

describe("sendPushToUser to the iPhone app", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const p8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  async function saveAppleKey() {
    const values = { "apns.key": p8, "apns.keyId": "ABC123DEFG", "apns.teamId": "TEAM123456", "apns.bundleId": "com.example.app" };
    for (const [key, value] of Object.entries(values)) {
      await db.serverSetting.upsert({
        where: { key },
        create: { key, encryptedValue: encryptSecret(value) },
        update: { encryptedValue: encryptSecret(value) },
      });
    }
  }

  async function iphone(name: string, extra: Record<string, unknown> = {}, signIn: { tokenVersion?: number } = {}) {
    const device = await db.appDevice.create({
      data: {
        userId,
        name,
        platform: "ios",
        tokenHash: `hash-${seq}-${name}`,
        tokenPrefix: "ftd_x",
        tokenVersion: signIn.tokenVersion ?? 0,
        lastUsedAt: new Date(),
      },
    });
    return db.appPushToken.create({
      data: { appDeviceId: device.id, userId, token: `${seq}${name}`.padEnd(64, "a"), environment: "production", ...extra },
    });
  }

  const apnsOk = () =>
    vi.fn<ApnsSender>(async (targets) => new Map(targets.map((t) => [t.token, { ok: true as const }])));

  it("sends nothing to phones while the server has no Apple key", async () => {
    await db.serverSetting.deleteMany({ where: { key: { startsWith: "apns." } } });
    await iphone("phone");
    const apns = apnsOk();
    expect(await push.sendPushToUser(userId, "billReminders", message, { client: db, apns })).toEqual({ devices: 0, delivered: 0 });
    expect(apns).not.toHaveBeenCalled();
  });

  it("sends to each signed-in phone with the alert on, without amounts where it asked, and to no stale sign-in", async () => {
    await saveAppleKey();
    const plain = await iphone("plain");
    const hidden = await iphone("hidden", { hideAmounts: true });
    await iphone("off", { billReminders: false });
    await iphone("signed-out-elsewhere", {}, { tokenVersion: 5 });
    const apns = apnsOk();
    expect(await push.sendPushToUser(userId, "billReminders", { ...message, url: "/?tab=bills" }, { client: db, apns })).toEqual({
      devices: 2,
      delivered: 2,
    });
    const [targets, messageFor, credentials] = apns.mock.calls[0]!;
    expect(targets.map((t) => t.token).sort()).toEqual([hidden.token, plain.token].sort());
    expect(credentials).toMatchObject({ keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "com.example.app" });
    expect(messageFor({ token: plain.token, environment: "production" })).toMatchObject({
      title: message.title,
      body: message.body,
      data: { kind: "billReminders", url: "/?tab=bills" },
    });
    const privateText = messageFor({ token: hidden.token, environment: "production" });
    expect(privateText).toMatchObject(push.PRIVATE_PUSH_TEXT.billReminders);
    expect(JSON.stringify(privateText)).not.toContain("$80");
    expect((await db.appPushToken.findUniqueOrThrow({ where: { id: plain.id } })).lastSentAt).not.toBeNull();
  });

  it("forgets a token Apple says is gone, and holds nothing against a phone when Apple refuses the key", async () => {
    await saveAppleKey();
    const gone = await iphone("gone");
    const kept = await iphone("kept", { failureCount: 9 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const apns = vi.fn<ApnsSender>(
      async (targets) =>
        new Map(
          targets.map((t) => [
            t.token,
            t.token === gone.token
              ? { ok: false as const, gone: true, credentialsRejected: false, status: 410, reason: "Unregistered" }
              : { ok: false as const, gone: false, credentialsRejected: true, status: 403, reason: "InvalidProviderToken" },
          ]),
        ),
    );
    expect(await push.sendPushToUser(userId, "chargeAlerts", message, { client: db, apns })).toEqual({ devices: 2, delivered: 0 });
    expect(await db.appPushToken.findUnique({ where: { id: gone.id } })).toBeNull();
    expect((await db.appPushToken.findUniqueOrThrow({ where: { id: kept.id } })).failureCount).toBe(9);
    errorSpy.mockRestore();
  });
});

describe("deliverAlert", () => {
  const alert = () => ({ userId, to: "me@example.test", kind: "chargeAlerts" as const, subject: "Large charge", text: "…", push: message });
  const noSmtp = async () => ({ sent: false, reason: "SMTP not configured" });
  let pushOk = vi.fn(async () => ({ ok: true as const }));
  beforeEach(() => {
    pushOk = vi.fn(async () => ({ ok: true as const }));
  });

  it("is sent when the phone got it, even without email", async () => {
    await device("phone");
    expect(await push.deliverAlert(alert(), { client: db, send: noSmtp, push: pushOk })).toBe("sent");
  });

  it("has no channel when there is no SMTP and no phone with that alert on", async () => {
    await device("phone", { chargeAlerts: false });
    expect(await push.deliverAlert(alert(), { client: db, send: noSmtp, push: pushOk })).toBe("no-channel");
    expect(pushOk).not.toHaveBeenCalled();
  });

  it("failed when a channel was there but nothing got through", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const smtpDown = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await push.deliverAlert(alert(), { client: db, send: smtpDown, push: pushOk })).toBe("failed");
    await device("phone");
    const pushDown = vi.fn(async () => ({ ok: false as const, gone: false, status: 503, error: "down" }));
    expect(await push.deliverAlert(alert(), { client: db, send: noSmtp, push: pushDown })).toBe("failed");
    errorSpy.mockRestore();
  });
});

describe("describePushDevice", () => {
  it("names the device from its browser", () => {
    expect(
      push.describePushDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"),
    ).toBe("iPhone");
    expect(
      push.describePushDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"),
    ).toBe("Chrome on Android");
    expect(
      push.describePushDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"),
    ).toBe("Edge on Windows");
  });
});

describe("vapidSubject", () => {
  it("uses the site's https address, else the mail sender", () => {
    expect(push.vapidSubject({ NEXTAUTH_URL: "https://money.example/app" })).toBe("https://money.example");
    expect(push.vapidSubject({ NEXTAUTH_URL: "http://localhost:3000", SMTP_FROM: "Tracker <bot@money.example>" })).toBe(
      "mailto:bot@money.example",
    );
  });
});
