import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The phone's Select in Transactions, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-bulk-edit-"));
const url = `file:${join(dir, "bulk.db")}`;
let db: PrismaClient;
let api: typeof import("./bulk-edit");
let undo: typeof import("@/lib/transaction-undo");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./bulk-edit");
  undo = await import("@/lib/transaction-undo");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let foodId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `bulk${seq}@example.test`, displayName: "Test" } })).id;
  foodId = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
});

function entry(type: "EXPENSE" | "INCOME" = "EXPENSE", extra: Record<string, unknown> = {}) {
  return db.transaction.create({
    data: { userId, categoryId: foodId, type, amountCents: 1_000, date: new Date("2026-11-01T00:00:00Z"), needsReview: true, ...extra },
  });
}

describe("bulkEditFromApi", () => {
  it("marks the picked expenses reviewed, leaving income and other people's rows alone", async () => {
    const a = await entry();
    const income = await entry("INCOME");
    const otherUser = (await db.user.create({ data: { email: `bulk-other${seq}@example.test`, displayName: "Other" } })).id;
    const theirs = await db.transaction.create({
      data: { userId: otherUser, categoryId: (await db.category.create({ data: { userId: otherUser, name: "X", kind: "EXPENSE" } })).id, type: "EXPENSE", amountCents: 5, date: new Date(), needsReview: true },
    });
    expect(await api.bulkEditFromApi(db, userId, { ids: [a.id, income.id, theirs.id], op: "reviewed" })).toMatchObject({ ok: true, changed: 1 });
    const flags = await db.transaction.findMany({ where: { id: { in: [a.id, income.id, theirs.id] } }, select: { id: true, needsReview: true } });
    expect(Object.fromEntries(flags.map((f) => [f.id, f.needsReview]))).toEqual({ [a.id]: false, [income.id]: true, [theirs.id]: true });
  });

  it("deletes with an undo id for each, which puts each back", async () => {
    const a = await entry();
    const b = await entry();
    const result = await api.bulkEditFromApi(db, userId, { ids: [a.id, b.id, a.id], op: "delete" });
    if (!result.ok) throw new Error(result.error);
    expect(result.changed).toBe(2);
    expect(await db.transaction.count({ where: { userId } })).toBe(0);
    for (const undoId of result.undoIds) expect(await undo.undoDeletedTransaction(db, userId, undoId)).toMatchObject({ ok: true });
    expect(await db.transaction.count({ where: { userId } })).toBe(2);
  });

  it("refuses an empty pick, an unknown change, and a category that is not the user's", async () => {
    const a = await entry();
    expect(await api.bulkEditFromApi(db, userId, { ids: [], op: "reviewed" })).toEqual({ ok: false, error: "Pick at least one expense." });
    expect(await api.bulkEditFromApi(db, userId, { ids: [a.id], op: "rename" })).toMatchObject({ ok: false });
    expect(await api.bulkEditFromApi(db, userId, { ids: [a.id], op: "category", value: "not-a-category" })).toEqual({
      ok: false,
      error: "Selected category was not found.",
    });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: a.id } })).categoryId).toBe(foodId);
  });
});
