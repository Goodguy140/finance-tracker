import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** One-off plans from the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-planned-"));
const url = `file:${join(dir, "planned.db")}`;
let db: PrismaClient;
let api: typeof import("./planned");
let record: typeof import("@/lib/planned-transactions-record");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./planned");
  record = await import("@/lib/planned-transactions-record");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let accountId: string;
let carId: string;
let refundId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `plan${seq}@example.test`, displayName: "Test" } })).id;
  accountId = (await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } })).id;
  carId = (await db.category.create({ data: { userId, name: "Car", kind: "EXPENSE" } })).id;
  refundId = (await db.category.create({ data: { userId, name: "Tax refund", kind: "INCOME" } })).id;
});

const plan = (overrides: Record<string, unknown> = {}) => ({
  type: "expense",
  name: "Brakes",
  amountCents: 60_000,
  date: "2026-11-20",
  accountId,
  categoryId: carId,
  ...overrides,
});

describe("plans from the phone", () => {
  it("adds a plan, lists it with whether its date has passed, and replaces its fields", async () => {
    const created = await api.createPlanFromApi(db, userId, plan());
    expect(created.ok).toBe(true);
    const id = created.ok ? created.id : "";
    expect((await api.loadAppPlans(db, userId, "2026-11-21")).plans).toMatchObject([
      { id, type: "expense", name: "Brakes", amountCents: 60_000, date: "2026-11-20", accountName: "Chequing", categoryName: "Car", pastDue: true },
    ]);
    expect(await api.updatePlanFromApi(db, userId, id, plan({ type: "income", name: "Refund", categoryId: refundId, note: "CRA" }))).toEqual({ ok: true, id });
    expect((await api.loadAppPlans(db, userId, "2026-11-01")).plans).toMatchObject([{ type: "income", name: "Refund", note: "CRA", pastDue: false }]);
  });

  it("refuses a category of the other kind, an archived account and a day that does not exist", async () => {
    expect(await api.createPlanFromApi(db, userId, plan({ categoryId: refundId }))).toMatchObject({ ok: false, status: 404 });
    expect(await api.createPlanFromApi(db, userId, plan({ date: "2026-02-30" }))).toMatchObject({ ok: false, status: 400 });
    expect(await api.createPlanFromApi(db, userId, plan({ amountCents: -5 }))).toMatchObject({ ok: false, status: 400 });
    await db.account.update({ where: { id: accountId }, data: { archived: true } });
    expect(await api.createPlanFromApi(db, userId, plan())).toMatchObject({ ok: false, status: 404 });
    expect(await db.plannedTransaction.count({ where: { userId } })).toBe(0);
  });

  it("records a plan once, on the date given, and leaves a recorded plan alone", async () => {
    const created = await api.createPlanFromApi(db, userId, plan());
    const id = created.ok ? created.id : "";
    const { transactionId } = await record.recordPlannedTransaction(db, userId, id, "2026-11-22");
    expect(await db.transaction.findUniqueOrThrow({ where: { id: transactionId } })).toMatchObject({
      title: "Brakes",
      amountCents: 60_000,
      type: "EXPENSE",
      date: new Date(Date.UTC(2026, 10, 22)),
    });
    await expect(record.recordPlannedTransaction(db, userId, id)).rejects.toThrow("This plan has already happened.");
    expect(await api.updatePlanFromApi(db, userId, id, plan())).toMatchObject({ ok: false, status: 409 });
    expect((await api.loadAppPlans(db, userId, "2026-11-30")).plans).toEqual([]);
  });

  it("removes only the user's own plan", async () => {
    const created = await api.createPlanFromApi(db, userId, plan());
    const id = created.ok ? created.id : "";
    expect(await api.deletePlanFromApi(db, "someone-else", id)).toBe(false);
    expect(await api.deletePlanFromApi(db, userId, id)).toBe(true);
    expect(await db.plannedTransaction.count({ where: { userId } })).toBe(0);
  });
});
