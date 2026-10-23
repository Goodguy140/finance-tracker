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

  it("parses query strings, rejecting bad limits and dates", () => {
    expect(api.parseListQuery(new URLSearchParams("limit=50&type=expense"))).toMatchObject({ ok: true, query: { limit: 50, type: "expense" } });
    expect(api.parseListQuery(new URLSearchParams(""))).toMatchObject({ ok: true, query: { limit: api.API_LIST_DEFAULT_LIMIT } });
    expect(api.parseListQuery(new URLSearchParams("limit=5000")).ok).toBe(false);
    expect(api.parseListQuery(new URLSearchParams("from=yesterday")).ok).toBe(false);
  });
});
