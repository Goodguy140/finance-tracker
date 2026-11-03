import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "app-push-"));
const url = `file:${join(dir, "push.db")}`;
let db: PrismaClient;
let appPush: typeof import("./app-push");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  appPush = await import("./app-push");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const TOKEN = "AB".repeat(32);

async function signIn(email: string) {
  const user = await db.user.create({ data: { email, displayName: "Test" } });
  const device = await db.appDevice.create({
    data: { userId: user.id, name: "iPhone", platform: "ios", tokenHash: `hash-${email}`, tokenPrefix: "ftd_x", tokenVersion: 0 },
  });
  return { id: device.id, userId: user.id };
}

function parse(body: unknown) {
  const parsed = appPush.parsePushRegistration(body);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

it("keeps each switch it is not told about, and moves a token to whoever signed in on the phone last", async () => {
  const first = await signIn("first@example.test");
  expect(await appPush.registerAppPush(db, first, parse({ token: TOKEN }))).toEqual({
    environment: "production",
    alerts: { billReminders: true, chargeAlerts: true, budgetAlerts: true },
    hideAmounts: false,
  });
  expect(await appPush.registerAppPush(db, first, parse({ token: TOKEN, alerts: { chargeAlerts: false }, hideAmounts: true }))).toMatchObject({
    alerts: { billReminders: true, chargeAlerts: false, budgetAlerts: true },
    hideAmounts: true,
  });
  // Stored as Apple's hex, whatever case the phone sent.
  expect((await db.appPushToken.findUniqueOrThrow({ where: { appDeviceId: first.id } })).token).toBe(TOKEN.toLowerCase());

  // Someone else signs in on the same phone without the first signing out: the phone is theirs now.
  const second = await signIn("second@example.test");
  await appPush.registerAppPush(db, second, parse({ token: TOKEN }));
  expect(await db.appPushToken.findUnique({ where: { appDeviceId: first.id } })).toBeNull();
  expect(await db.appPushToken.findUnique({ where: { appDeviceId: second.id } })).toMatchObject({ userId: second.userId });

  // Signing the phone out ends its alerts.
  await db.appDevice.delete({ where: { id: second.id } });
  expect(await db.appPushToken.count()).toBe(0);
});

it("refuses a token that is not an APNs device token", () => {
  expect(appPush.parsePushRegistration({ token: "ExponentPushToken[abc]" })).toMatchObject({ ok: false });
  expect(appPush.parsePushRegistration({ token: TOKEN, environment: "staging" })).toMatchObject({ ok: false });
});
