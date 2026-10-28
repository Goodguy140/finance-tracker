import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
