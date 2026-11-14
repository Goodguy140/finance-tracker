import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "safe-to-spend-"));
const url = `file:${join(dir, "safe-to-spend.db")}`;
let db: PrismaClient;
let api: typeof import("./safe-to-spend");

beforeAll(async () => {
  copyMigratedDatabase(url);
  // Savings goals load through the app's shared client, which reads DATABASE_URL when first loaded.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./safe-to-spend");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// 28 October 2026, 08:00 in Toronto: insurance on the 3rd is next month's, past the forecast
// Safe to spend makes without a buffer (to the 1st).
const now = new Date("2026-10-28T12:00:00Z");

describe("GET/PATCH /api/v1/safe-to-spend", () => {
  it("saves the buffer, and Safe to spend then holds back next month's insurance", async () => {
    const user = await db.user.create({ data: { email: "buffer@example.test", displayName: "Test" } });
    const insurance = await db.category.create({ data: { userId: user.id, name: "Insurance", kind: "EXPENSE" } });
    const account = await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } });
    await db.recurringTransaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: insurance.id,
        type: "EXPENSE",
        name: "Car insurance",
        amountCents: 15_000,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-11-03T00:00:00Z"),
      },
    });

    const before = await api.serializeSafeToSpendSettings(db, user, now);
    expect(before).toMatchObject({ bufferDays: null, maxBufferDays: 60, currency: "CAD" });
    expect(before.safeToSpend).toMatchObject({ bufferBillsCents: 0, safeCents: 0 });

    expect(await api.patchSafeToSpendSettingsFromApi(db, user.id, { bufferDays: 5 })).toEqual({ ok: true });
    // `user` is the row from before the change: the number must still follow the saved buffer.
    const after = await api.serializeSafeToSpendSettings(db, user, now);
    expect(after.bufferDays).toBe(5);
    expect(after.safeToSpend).toMatchObject({ bufferUntilYmd: "2026-11-02", bufferBillsCents: 0, safeCents: 0 });
    expect(await api.patchSafeToSpendSettingsFromApi(db, user.id, { bufferDays: 6 })).toEqual({ ok: true });
    expect((await api.serializeSafeToSpendSettings(db, user, now)).safeToSpend).toMatchObject({
      bufferDays: 6,
      bufferUntilYmd: "2026-11-03",
      bufferBillsCents: 15_000,
      safeCents: -15_000,
    });

    for (const bad of [{ bufferDays: 0 }, { bufferDays: 61 }, { bufferDays: 2.5 }, { bufferDays: "7" }, {}, { bufferDays: 7, other: 1 }]) {
      expect(await api.patchSafeToSpendSettingsFromApi(db, user.id, bad)).toMatchObject({ ok: false });
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).safeToSpendBufferDays).toBe(6);

    expect(await api.patchSafeToSpendSettingsFromApi(db, user.id, { bufferDays: null })).toEqual({ ok: true });
    expect((await api.serializeSafeToSpendSettings(db, user, now)).safeToSpend).toMatchObject({ bufferDays: null, safeCents: 0 });
  });

  it("turns zero-based budgeting on and off, leaving the buffer as it was", async () => {
    const user = await db.user.create({ data: { email: "zero@example.test", displayName: "Test", safeToSpendBufferDays: 4 } });
    expect((await api.serializeSafeToSpendSettings(db, user, now)).zeroBased).toBe(false);
    expect(await api.patchSafeToSpendSettingsFromApi(db, user.id, { zeroBased: true })).toEqual({ ok: true });
    expect(await api.serializeSafeToSpendSettings(db, user, now)).toMatchObject({ zeroBased: true, bufferDays: 4 });
    expect(await api.patchSafeToSpendSettingsFromApi(db, user.id, { zeroBased: "yes" })).toMatchObject({ ok: false });
    expect(await api.patchSafeToSpendSettingsFromApi(db, user.id, { zeroBased: false, bufferDays: null })).toEqual({ ok: true });
    expect(await api.serializeSafeToSpendSettings(db, user, now)).toMatchObject({ zeroBased: false, bufferDays: null });
  });
});
