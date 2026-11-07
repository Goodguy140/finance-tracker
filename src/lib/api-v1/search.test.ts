import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Search and saved searches from the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-search-"));
const url = `file:${join(dir, "search.db")}`;
let db: PrismaClient;
let api: typeof import("./search");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./search");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; countryCode: string };
let food: string;
let pay: string;
let move: string;
let chequing: string;
let savings: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `search${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, countryCode: true },
  });
  food = (await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } })).id;
  pay = (await db.category.create({ data: { userId: user.id, name: "Pay", kind: "INCOME" } })).id;
  move = (await db.category.create({ data: { userId: user.id, name: "Transfer", kind: "TRANSFER" } })).id;
  chequing = (await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING", currency: "CAD" } })).id;
  savings = (await db.account.create({ data: { userId: user.id, name: "Savings", type: "SAVINGS", currency: "CAD" } })).id;
});

function add(data: { type: "EXPENSE" | "INCOME" | "TRANSFER"; amountCents: number; date: string; title: string } & Record<string, unknown>) {
  const categoryId = data.type === "EXPENSE" ? food : data.type === "INCOME" ? pay : move;
  return db.transaction.create({
    data: { userId: user.id, categoryId, accountId: chequing, ...data, date: new Date(`${data.date}T00:00:00Z`) },
  });
}

const query = (params: Record<string, string>) => {
  const parsed = api.parseSearchQuery(new URLSearchParams(params));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.query;
};

describe("search on the phone", () => {
  it("finds every month at once, with the website's totals and an account on either side of a transfer", async () => {
    await add({ type: "EXPENSE", amountCents: 450, date: "2025-03-02", title: "Coffee shop" });
    await add({ type: "EXPENSE", amountCents: 525, date: "2026-10-09", title: "Coffee beans", needsReview: true });
    await add({ type: "EXPENSE", amountCents: 9_000, date: "2026-10-10", title: "Groceries" });
    await add({ type: "INCOME", amountCents: 200_000, date: "2026-10-15", title: "Paycheque" });
    await add({ type: "TRANSFER", amountCents: 50_000, date: "2026-10-16", title: "To savings", transferAccountId: savings });

    const coffee = await api.searchTransactionsForApi(db, user, query({ q: "coffee" }));
    expect(coffee.ok && coffee.transactions.map((t) => t.title)).toEqual(["Coffee beans", "Coffee shop"]);
    expect(coffee.ok && coffee).toMatchObject({ currency: "CAD", totals: { count: 2, spentCents: 975, receivedCents: 0 } });

    // Savings is only the other side of the transfer; the website's search still finds it there.
    const onSavings = await api.searchTransactionsForApi(db, user, query({ accountId: savings }));
    expect(onSavings.ok && onSavings.transactions.map((t) => t.title)).toEqual(["To savings"]);
    expect(onSavings.ok && onSavings.totals).toEqual({ count: 1, spentCents: 0, receivedCents: 0 });

    const all = await api.searchTransactionsForApi(db, user, query({ accountId: chequing }));
    expect(all.ok && all.totals).toEqual({ count: 5, spentCents: 9_975, receivedCents: 200_000 });

    // Needs review narrows the search, and its totals with it.
    const waiting = await api.searchTransactionsForApi(db, user, query({ q: "coffee", needsReview: "true" }));
    expect(waiting.ok && waiting.totals).toEqual({ count: 1, spentCents: 525, receivedCents: 0 });

    // Totals come with the first page only.
    const first = await api.searchTransactionsForApi(db, user, query({ accountId: chequing, limit: "2" }));
    expect(first.ok && first.nextCursor).toBeTruthy();
    const next = await api.searchTransactionsForApi(db, user, query({ accountId: chequing, limit: "2", cursor: first.ok ? first.nextCursor! : "" }));
    expect(next.ok && next).toMatchObject({ totals: null });
    expect(next.ok && next.transactions).toHaveLength(2);
  });

  it("saves a search with its filters, lists it with what it finds now, and deletes it", async () => {
    await add({ type: "EXPENSE", amountCents: 450, date: "2026-10-02", title: "Coffee shop" });
    await add({ type: "INCOME", amountCents: 1_000, date: "2026-10-03", title: "Coffee refund club" });

    const saved = await api.saveSearchFromApi(db, user.id, { name: " Coffee ", q: "coffee", type: "expense", categoryId: food });
    expect(saved.ok).toBe(true);
    const { searches, currency } = await api.serializeSavedSearches(db, user);
    expect(currency).toBe("CAD");
    expect(searches).toEqual([
      {
        id: saved.ok ? saved.id : "",
        name: "Coffee",
        q: "coffee",
        type: "expense",
        accountId: null,
        categoryId: food,
        tagId: null,
        count: 1,
        spentCents: 450,
        receivedCents: 0,
        summary: expect.stringMatching(/^1 transaction · Spent \S*4\.50$/),
      },
    ]);

    expect(await api.deleteSavedSearchFromApi(db, user.id, saved.ok ? saved.id : "")).toMatchObject({ ok: true });
    expect(await api.deleteSavedSearchFromApi(db, user.id, saved.ok ? saved.id : "")).toEqual({
      ok: false,
      status: 404,
      error: "That saved search was already removed.",
    });
  });

  it("refuses a search with nothing in it, or a category that is not the user's", async () => {
    expect(await api.saveSearchFromApi(db, user.id, { name: "Nothing" })).toEqual({
      ok: false,
      status: 400,
      error: "Search for something first, then save it.",
    });
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.category.create({ data: { userId: other.id, name: "Theirs", kind: "EXPENSE" } });
    expect(await api.saveSearchFromApi(db, user.id, { name: "Theirs", categoryId: theirs.id })).toMatchObject({ ok: false, status: 400 });
    expect(await api.saveSearchFromApi(db, user.id, { name: "", q: "x" })).toMatchObject({ ok: false, error: "Give the search a name." });
    expect(await db.savedSearch.count({ where: { userId: user.id } })).toBe(0);
  });
});
