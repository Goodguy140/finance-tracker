import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Alert timing from the phone, against a real SQLite database built from the migrations, with no SMTP. */

const dir = mkdtempSync(join(tmpdir(), "api-alert-timing-"));
const url = `file:${join(dir, "timing.db")}`;
let db: PrismaClient;
let api: typeof import("./alert-timing");

beforeAll(async () => {
  for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) delete process.env[key];
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./alert-timing");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; timezone: string };

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `timing${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true },
  });
});

async function phoneWithAlerts() {
  const device = await db.appDevice.create({
    data: { userId: user.id, name: "iPhone", platform: "ios", tokenHash: `hash-${seq}`, tokenPrefix: "ftd_x", tokenVersion: 0 },
  });
  await db.appPushToken.create({ data: { appDeviceId: device.id, userId: user.id, token: `${seq}`.padEnd(64, "a"), environment: "production" } });
}

const read = () => api.serializeAlertTiming(db, user.id);

describe("alert timing on the phone", () => {
  it("starts off, and turns reminders and charge alerts on only where something can deliver them", async () => {
    expect(await read()).toEqual({
      emailAvailable: false,
      billReminderDays: null,
      chargeThresholdCents: null,
      chargeUnusual: false,
      digest: "off",
      budgetAlertEmail: false,
      billReminderOptions: [1, 3, 7],
    });
    expect(await api.patchAlertTimingFromApi(db, user, { billReminderDays: 3 })).toEqual({
      ok: false,
      error: "Bill reminders need SMTP on the server, or a phone with bill reminders on under Phone notifications.",
    });
    expect(await api.patchAlertTimingFromApi(db, user, { chargeUnusual: true })).toMatchObject({ ok: false });

    await phoneWithAlerts();
    expect(await api.patchAlertTimingFromApi(db, user, { billReminderDays: 3 })).toEqual({ ok: true });
    expect(await api.patchAlertTimingFromApi(db, user, { billReminderDays: null })).toEqual({ ok: true });
    expect(await api.patchAlertTimingFromApi(db, user, { billReminderDays: 7 })).toEqual({ ok: true });
    expect(await read()).toMatchObject({ billReminderDays: 7 });

    // Without email, the digest and budget emails stay off.
    expect(await api.patchAlertTimingFromApi(db, user, { digest: "weekly" })).toEqual({
      ok: false,
      error: "The email digest needs SMTP configured on the server first.",
    });
    expect(await api.patchAlertTimingFromApi(db, user, { budgetAlertEmail: true })).toMatchObject({ ok: false });
    expect(await api.patchAlertTimingFromApi(db, user, { digest: "off", budgetAlertEmail: false })).toEqual({ ok: true });
  });

  it("changes the charge amount and the unusual check one at a time, starting from now when turned on", async () => {
    await phoneWithAlerts();
    expect(await api.patchAlertTimingFromApi(db, user, { chargeThresholdCents: 50_000 })).toEqual({ ok: true });
    const started = (await db.chargeAlertSetting.findUniqueOrThrow({ where: { userId: user.id } })).checkedThrough;
    expect(await api.patchAlertTimingFromApi(db, user, { chargeUnusual: true })).toEqual({ ok: true });
    expect(await read()).toMatchObject({ chargeThresholdCents: 50_000, chargeUnusual: true });
    // Still on, so what has been looked at already is not looked at again.
    expect((await db.chargeAlertSetting.findUniqueOrThrow({ where: { userId: user.id } })).checkedThrough).toEqual(started);
    expect(await api.patchAlertTimingFromApi(db, user, { chargeThresholdCents: null })).toEqual({ ok: true });
    expect(await read()).toMatchObject({ chargeThresholdCents: null, chargeUnusual: true });
  });

  it("refuses what Settings → Notifications does not offer", async () => {
    expect(await api.patchAlertTimingFromApi(db, user, { billReminderDays: 5 })).toEqual({
      ok: false,
      error: "'billReminderDays' must be 1, 3 or 7, or null.",
    });
    expect(await api.patchAlertTimingFromApi(db, user, { chargeThresholdCents: 0 })).toMatchObject({ ok: false });
    expect(await api.patchAlertTimingFromApi(db, user, { digest: "daily" })).toMatchObject({ ok: false });
    expect(await api.patchAlertTimingFromApi(db, user, { somethingElse: 1 })).toMatchObject({ ok: false });
  });
});
