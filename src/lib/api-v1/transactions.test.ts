import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

const dir = mkdtempSync(join(tmpdir(), "api-v1-"));
const url = `file:${join(dir, "api.db")}`;
let db: PrismaClient;
let api: typeof import("./transactions");

beforeAll(async () => {
  copyMigratedDatabase(url);
  // loadRuleContext reads through the app's shared client, which reads DATABASE_URL on load.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./transactions");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; timezone: string };
let foodId: string;
let visaId: string;

beforeEach(async () => {
  seq += 1;
  const created = await db.user.create({ data: { email: `api${seq}@example.test`, displayName: "API", timezone: "America/Toronto" } });
  user = { id: created.id, timezone: "America/Toronto" };
  foodId = (await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } })).id;
  await db.category.create({ data: { userId: user.id, name: "Other", kind: "EXPENSE" } });
  await db.category.create({ data: { userId: user.id, name: "Salary", kind: "INCOME" } });
  visaId = (await db.account.create({ data: { userId: user.id, name: "Visa", type: "CREDIT_CARD" } })).id;
});

describe("createTransactionFromApi", () => {
  it("logs an expense with category and account given by name, and tags", async () => {
    const result = await api.createTransactionFromApi(db, user, {
      type: "expense",
      amount: "12.50",
      title: "Coffee",
      date: "2026-10-01",
      category: "food",
      account: "VISA",
      tags: ["Work"],
    });
    expect(result).toMatchObject({
      ok: true,
      transaction: { type: "expense", amountCents: 1250, title: "Coffee", date: "2026-10-01", categoryId: foodId, accountId: visaId, tags: ["Work"] },
    });
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(1);
  });

  it("fills the category from the user's rules when none is given", async () => {
    await db.transactionRule.create({
      data: { userId: user.id, priority: 1, titleOperator: "CONTAINS", titlePattern: "starbucks", setCategoryId: foodId, appendNote: "via rule" },
    });
    const result = await api.createTransactionFromApi(db, user, { type: "expense", amountCents: 600, title: "STARBUCKS 123" });
    expect(result).toMatchObject({ ok: true, transaction: { categoryId: foodId, note: "via rule" } });
  });

  it("books what a 'Mark as transfer' rule matches as a transfer, unless the request names a category", async () => {
    const tfsaId = (await db.account.create({ data: { userId: user.id, name: "TFSA", type: "TFSA" } })).id;
    await db.transactionRule.create({
      data: { userId: user.id, priority: 1, titleOperator: "CONTAINS", titlePattern: "tfsa", markAsTransfer: true, setTransferAccountId: tfsaId },
    });

    const out = await api.createTransactionFromApi(db, user, { type: "expense", amountCents: 50_000, title: "TFSA top-up", account: "Visa" });
    expect(out).toMatchObject({ ok: true, transaction: { type: "transfer", amountCents: 50_000, accountId: visaId, transferAccountId: tfsaId } });
    if (!out.ok) return;
    expect((await db.category.findUniqueOrThrow({ where: { id: out.transaction.categoryId } })).kind).toBe("TRANSFER");

    // Money in: a transfer's positive amount left `accountId`, so this one is negative.
    const back = await api.createTransactionFromApi(db, user, { type: "income", amountCents: 20_000, title: "From TFSA", account: "Visa" });
    expect(back).toMatchObject({ ok: true, transaction: { type: "transfer", amountCents: -20_000 } });

    const named = await api.createTransactionFromApi(db, user, { type: "expense", amountCents: 900, title: "TFSA fee", category: "Food" });
    expect(named).toMatchObject({ ok: true, transaction: { type: "expense", categoryId: foodId } });
  });

  it("falls back to the catch-all category and today's date", async () => {
    const result = await api.createTransactionFromApi(db, user, { type: "income", amount: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The income fallback category, whichever that is, never an expense one.
    const category = await db.category.findUniqueOrThrow({ where: { id: result.transaction.categoryId } });
    expect(category.kind).toBe("INCOME");
    expect(category.userId).toBe(user.id);
    expect(result.transaction.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses bad input and names in other users' data", async () => {
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.category.create({ data: { userId: other.id, name: "Theirs", kind: "EXPENSE" } });
    const cases: Array<[unknown, number, RegExp]> = [
      [{ type: "expense" }, 400, /exactly one of/],
      [{ type: "expense", amount: 1, amountCents: 100 }, 400, /exactly one of/],
      [{ type: "income", amount: -5 }, 400, /positive/],
      [{ type: "expense", amount: 0 }, 400, /out of range/],
      [{ type: "expense", amount: 1, date: "Oct 1" }, 400, /YYYY-MM-DD/],
      [{ type: "expense", amount: 1, colour: "red" }, 400, /Unknown field 'colour'/],
      [{ type: "expense", amount: 1, categoryId: theirs.id }, 404, /category/],
      [{ type: "expense", amount: 1, category: "Nope" }, 404, /Nope/],
      [{ type: "expense", amount: 1, account: "Nope" }, 404, /account/],
      [{ type: "transfer", amount: 1 }, 400, /./],
    ];
    for (const [body, status, error] of cases) {
      const result = await api.createTransactionFromApi(db, user, body);
      expect(result.ok, JSON.stringify(body)).toBe(false);
      if (result.ok) continue;
      expect(result.status, JSON.stringify(body)).toBe(status);
      expect(result.error, JSON.stringify(body)).toMatch(error);
    }
    expect(await db.transaction.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("listTransactionsForApi", () => {
  async function seed(n: number) {
    for (let i = 1; i <= n; i += 1) {
      await db.transaction.create({
        data: { userId: user.id, categoryId: foodId, type: "EXPENSE", amountCents: i * 100, date: new Date(Date.UTC(2026, 8, i)), title: `T${i}` },
      });
    }
  }

  it("pages newest first with a cursor, and filters by date and type", async () => {
    await seed(5);
    const first = await api.listTransactionsForApi(db, user.id, { limit: 2 });
    if (!first.ok) throw new Error(first.error);
    expect(first.transactions.map((t) => t.title)).toEqual(["T5", "T4"]);
    const second = await api.listTransactionsForApi(db, user.id, { limit: 2, cursor: first.nextCursor! });
    if (!second.ok) throw new Error(second.error);
    expect(second.transactions.map((t) => t.title)).toEqual(["T3", "T2"]);
    const last = await api.listTransactionsForApi(db, user.id, { limit: 2, cursor: second.nextCursor! });
    if (!last.ok) throw new Error(last.error);
    expect(last.transactions.map((t) => t.title)).toEqual(["T1"]);
    expect(last.nextCursor).toBeNull();

    const window = await api.listTransactionsForApi(db, user.id, { limit: 100, from: "2026-09-02", to: "2026-09-03" });
    if (!window.ok) throw new Error(window.error);
    expect(window.transactions.map((t) => t.title)).toEqual(["T3", "T2"]);
    const incomes = await api.listTransactionsForApi(db, user.id, { limit: 100, type: "income" });
    expect(incomes.ok && incomes.transactions).toEqual([]);
  });

  it("never lists another user's rows, nor pages from their cursor", async () => {
    await seed(1);
    const other = await db.user.create({ data: { email: `x${seq}@example.test`, displayName: "X" } });
    const otherCat = await db.category.create({ data: { userId: other.id, name: "F", kind: "EXPENSE" } });
    const theirs = await db.transaction.create({
      data: { userId: other.id, categoryId: otherCat.id, type: "EXPENSE", amountCents: 1, date: new Date() },
    });
    const mine = await api.listTransactionsForApi(db, user.id, { limit: 100 });
    expect(mine.ok && mine.transactions.map((t) => t.title)).toEqual(["T1"]);
    expect(await api.listTransactionsForApi(db, user.id, { limit: 100, cursor: theirs.id })).toEqual({ ok: false, error: "Unknown 'cursor'." });
  });

  it("searches across months, and filters by tag and needs review", async () => {
    await seed(3);
    const trip = await db.tag.create({ data: { userId: user.id, name: "Trip", nameKey: "trip" } });
    const t2 = await db.transaction.findFirstOrThrow({ where: { userId: user.id, title: "T2" } });
    await db.transaction.update({
      where: { id: t2.id },
      data: { needsReview: true, note: "hotel deposit", tags: { create: [{ tagId: trip.id }] } },
    });
    const titles = async (query: Parameters<typeof api.listTransactionsForApi>[2]) => {
      const result = await api.listTransactionsForApi(db, user.id, query);
      if (!result.ok) throw new Error(result.error);
      return result.transactions.map((t) => t.title);
    };
    expect(await titles({ limit: 100, q: "HOTEL" })).toEqual(["T2"]);
    // An amount finds the entry, as the website's search does.
    expect(await titles({ limit: 100, q: "3.00" })).toEqual(["T3"]);
    expect(await titles({ limit: 100, tagId: trip.id })).toEqual(["T2"]);
    expect(await titles({ limit: 100, needsReview: "true" })).toEqual(["T2"]);
    expect(await titles({ limit: 100, needsReview: "false" })).toEqual(["T3", "T1"]);
    const listed = await api.listTransactionsForApi(db, user.id, { limit: 100, q: "T2" });
    expect(listed.ok && listed.transactions[0]).toMatchObject({ needsReview: true, tags: ["Trip"], attachmentCount: 0 });
  });

  it("parses query strings, rejecting bad limits and dates", () => {
    expect(api.parseListQuery(new URLSearchParams("limit=50&type=expense"))).toMatchObject({ ok: true, query: { limit: 50, type: "expense" } });
    expect(api.parseListQuery(new URLSearchParams(""))).toMatchObject({ ok: true, query: { limit: api.API_LIST_DEFAULT_LIMIT } });
    expect(api.parseListQuery(new URLSearchParams("limit=5000")).ok).toBe(false);
    expect(api.parseListQuery(new URLSearchParams("from=yesterday")).ok).toBe(false);
  });
});

describe("updating, deleting and undoing from the phone", () => {
  async function expense(data: Partial<{ amountCents: number; creditCents: number; preCreditCents: number }> = {}) {
    return db.transaction.create({
      data: {
        userId: user.id,
        categoryId: foodId,
        accountId: visaId,
        type: "EXPENSE",
        amountCents: 2_500,
        needsReview: true,
        date: new Date(Date.UTC(2026, 9, 5)),
        title: "Lunch",
        ...data,
      },
    });
  }

  it("edits the fields it is given, replaces the tags and marks the entry reviewed", async () => {
    const row = await expense();
    const other = await db.category.findFirstOrThrow({ where: { userId: user.id, name: "Other" } });
    const result = await api.updateTransactionFromApi(db, user.id, row.id, {
      title: "Team lunch",
      amountCents: 3_100,
      categoryId: other.id,
      postedDate: "2026-10-06",
      tags: ["Work"],
    });
    expect(result).toMatchObject({
      ok: true,
      transaction: { title: "Team lunch", amountCents: 3_100, categoryId: other.id, accountId: visaId, postedDate: "2026-10-06", tags: ["Work"], needsReview: false },
    });
    // Unnamed fields are kept; null clears.
    const cleared = await api.updateTransactionFromApi(db, user.id, row.id, { accountId: null, postedDate: null, tags: [] });
    expect(cleared).toMatchObject({ ok: true, transaction: { title: "Team lunch", accountId: null, postedDate: null, tags: [] } });
  });

  it("marks an entry reviewed without changing anything else", async () => {
    const row = await expense();
    const result = await api.updateTransactionFromApi(db, user.id, row.id, { reviewed: true });
    expect(result).toMatchObject({ ok: true, transaction: { needsReview: false, amountCents: 2_500, title: "Lunch" } });
  });

  it("refuses what the phone does not edit, and anything not the user's", async () => {
    const credited = await expense({ preCreditCents: 3_000, creditCents: 500 });
    expect(await api.updateTransactionFromApi(db, user.id, credited.id, { amountCents: 100 })).toMatchObject({ ok: false, status: 400 });
    // The rest of a credited entry can still be edited.
    expect(await api.updateTransactionFromApi(db, user.id, credited.id, { title: "Dinner" })).toMatchObject({ ok: true });

    const transfer = await db.transaction.create({
      data: { userId: user.id, categoryId: foodId, accountId: visaId, type: "TRANSFER", amountCents: 1_000, date: new Date() },
    });
    expect(await api.updateTransactionFromApi(db, user.id, transfer.id, { amountCents: 2_000 })).toMatchObject({ ok: false, status: 400 });

    const row = await expense();
    expect(await api.updateTransactionFromApi(db, user.id, row.id, { colour: "red" })).toMatchObject({ ok: false, error: "Unknown field 'colour'." });
    const archived = await db.account.create({ data: { userId: user.id, name: "Old", type: "CHEQUING", archived: true } });
    expect(await api.updateTransactionFromApi(db, user.id, row.id, { accountId: archived.id })).toMatchObject({ ok: false, status: 404 });
    const salary = await db.category.findFirstOrThrow({ where: { userId: user.id, kind: "INCOME" } });
    expect(await api.updateTransactionFromApi(db, user.id, row.id, { categoryId: salary.id })).toMatchObject({ ok: false, status: 404 });

    const stranger = await db.user.create({ data: { email: `s${seq}@example.test`, displayName: "S" } });
    expect(await api.updateTransactionFromApi(db, stranger.id, row.id, { title: "Mine now" })).toMatchObject({ ok: false, status: 404 });
    expect(await api.deleteTransactionFromApi(db, stranger.id, row.id)).toBeNull();
    expect((await db.transaction.findUniqueOrThrow({ where: { id: row.id } })).title).toBe("Lunch");
  });

  it("deletes an entry and puts it back once", async () => {
    const row = await expense();
    const deleted = await api.deleteTransactionFromApi(db, user.id, row.id);
    expect(deleted).toMatchObject({ type: "expense" });
    expect(await db.transaction.count({ where: { id: row.id } })).toBe(0);

    const restored = await api.undoDeleteFromApi(db, user.id, deleted!.undoId);
    expect(restored).toMatchObject({ ok: true, transaction: { id: row.id, title: "Lunch", amountCents: 2_500 } });
    expect(await api.undoDeleteFromApi(db, user.id, deleted!.undoId)).toEqual({
      ok: false,
      error: "Too late to undo: deleted entries can be put back for 15 minutes.",
    });
  });
});
