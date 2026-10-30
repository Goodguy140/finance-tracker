import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The Expense Log's bulk bar against a real database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "bulk-edit-"));
const url = `file:${join(dir, "bulk.db")}`;
let db: PrismaClient;
let actions: typeof import("./transactions");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.userId })) }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./transactions");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let foodId: string;
let funId: string;
let visaId: string;
let chequingId: string;

beforeEach(async () => {
  seq += 1;
  session.userId = (await db.user.create({ data: { email: `b${seq}@example.test`, displayName: "Test" } })).id;
  foodId = (await db.category.create({ data: { userId: session.userId, name: "Food", kind: "EXPENSE" } })).id;
  funId = (await db.category.create({ data: { userId: session.userId, name: "Fun", kind: "EXPENSE" } })).id;
  visaId = (await db.account.create({ data: { userId: session.userId, name: "Visa", type: "CREDIT_CARD" } })).id;
  chequingId = (await db.account.create({ data: { userId: session.userId, name: "Chequing", type: "CHEQUING" } })).id;
});

function expense(userId = session.userId, extra: Record<string, unknown> = {}) {
  return db.transaction.create({
    data: {
      userId,
      accountId: userId === session.userId ? visaId : null,
      categoryId: foodId,
      type: "EXPENSE",
      amountCents: 1_000,
      date: new Date("2026-09-10T00:00:00Z"),
      ...extra,
    },
  });
}

function bulk(ids: string[], op: string, value = "") {
  const data = new FormData();
  data.set("transactionIdsJson", JSON.stringify(ids));
  data.set("op", op);
  data.set("value", value);
  return actions.bulkEditExpensesAction(data);
}

describe("bulk edit in the Expense Log", () => {
  it("moves plain expenses to a category and leaves split ones on their lines", async () => {
    const a = await expense();
    const b = await expense();
    const split = await expense(session.userId, {
      splitParts: { create: [{ userId: session.userId, categoryId: foodId, amountCents: 1_000 }] },
    });
    const result = await bulk([a.id, b.id, split.id], "category", funId);
    expect(result).toMatchObject({ ok: true, changed: 2, skipped: 1 });
    const rows = await db.transaction.findMany({ where: { id: { in: [a.id, b.id, split.id] } } });
    expect(rows.find((r) => r.id === split.id)!.categoryId).toBe(foodId);
    expect(rows.filter((r) => r.categoryId === funId).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("refuses another user's category and leaves everything as it was", async () => {
    const a = await expense();
    const other = (await db.user.create({ data: { email: `x${seq}@example.test`, displayName: "X" } })).id;
    const theirs = (await db.category.create({ data: { userId: other, name: "Theirs", kind: "EXPENSE" } })).id;
    expect(await bulk([a.id], "category", theirs)).toMatchObject({ ok: false });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: a.id } })).categoryId).toBe(foodId);
  });

  it("never touches another user's expense even when its id is sent", async () => {
    const other = (await db.user.create({ data: { email: `y${seq}@example.test`, displayName: "Y" } })).id;
    const otherFood = (await db.category.create({ data: { userId: other, name: "Food", kind: "EXPENSE" } })).id;
    const theirs = await expense(other, { categoryId: otherFood });
    const mine = await expense();
    expect(await bulk([theirs.id, mine.id], "account", chequingId)).toMatchObject({ ok: true, changed: 1 });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: theirs.id } })).accountId).toBeNull();
    expect((await db.transaction.findUniqueOrThrow({ where: { id: mine.id } })).accountId).toBe(chequingId);
    expect(await bulk([theirs.id], "delete")).toMatchObject({ ok: true, changed: 0 });
    expect(await db.transaction.count({ where: { id: theirs.id } })).toBe(1);
  });

  it("adds a tag to every selected expense, creating it once", async () => {
    const a = await expense();
    const b = await expense();
    expect(await bulk([a.id, b.id], "tag", "Trip")).toMatchObject({ ok: true, changed: 2 });
    const tags = await db.tag.findMany({ where: { userId: session.userId } });
    expect(tags.map((t) => t.name)).toEqual(["Trip"]);
    expect(await db.transactionTag.count({ where: { tagId: tags[0].id } })).toBe(2);
    // Tagging again does not double up.
    await bulk([a.id], "tag", "trip");
    expect(await db.transactionTag.count({ where: { tagId: tags[0].id } })).toBe(2);
  });

  it("deletes with one undo id per expense, and Undo brings them all back", async () => {
    const a = await expense();
    const b = await expense();
    const result = await bulk([a.id, b.id], "delete");
    if (!result.ok) throw new Error(result.error);
    expect(result.undoIds).toHaveLength(2);
    expect(await db.transaction.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0);

    const undo = new FormData();
    for (const id of result.undoIds) undo.append("undoId", id);
    await actions.undoDeleteTransactionAction(undo);
    expect(await db.transaction.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);
  });

  it("marks imported expenses reviewed, and never another user's", async () => {
    const mine = await expense(session.userId, { needsReview: true });
    const otherUser = (await db.user.create({ data: { email: `other-r${seq}@example.test`, displayName: "Other" } })).id;
    const theirs = await expense(otherUser, { needsReview: true });
    const result = await bulk([mine.id, theirs.id], "reviewed");
    expect(result).toMatchObject({ ok: true, changed: 1 });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: mine.id } })).needsReview).toBe(false);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: theirs.id } })).needsReview).toBe(true);
  });

  it("refuses an unknown change and an oversized selection", async () => {
    const a = await expense();
    expect(await bulk([a.id], "rename", "x")).toMatchObject({ ok: false });
    expect(await bulk(Array.from({ length: 501 }, (_, i) => `id${i}`), "delete")).toMatchObject({ ok: false });
  });
});

describe("marking income and transfers reviewed", () => {
  it("clears Needs review on the user's own rows of any kind, and only those", async () => {
    const salaryId = (await db.category.create({ data: { userId: session.userId, name: "Salary", kind: "INCOME" } })).id;
    const income = await expense(session.userId, { type: "INCOME", categoryId: salaryId, needsReview: true });
    const transfer = await expense(session.userId, { type: "TRANSFER", transferAccountId: chequingId, needsReview: true });
    const otherUser = (await db.user.create({ data: { email: `other-r${seq}@example.test`, displayName: "Other" } })).id;
    const otherCategory = (await db.category.create({ data: { userId: otherUser, name: "Pay", kind: "INCOME" } })).id;
    const theirs = await expense(otherUser, { type: "INCOME", categoryId: otherCategory, needsReview: true });

    const data = new FormData();
    data.set("transactionIdsJson", JSON.stringify([income.id, transfer.id, theirs.id]));
    const result = await actions.markTransactionsReviewedAction(data);

    expect(result).toMatchObject({ ok: true, changed: 2 });
    const rows = await db.transaction.findMany({ where: { id: { in: [income.id, transfer.id, theirs.id] } } });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.needsReview]))).toEqual({
      [income.id]: false,
      [transfer.id]: false,
      [theirs.id]: true,
    });
  });
});
