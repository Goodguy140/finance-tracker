import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { searchUserData, transactionSearchWhere } from "./search-data";

/** Against a real database: what matters is what the `where` clauses find in SQLite. */

const dir = mkdtempSync(join(tmpdir(), "search-"));
const url = `file:${join(dir, "search.db")}`;
let db: PrismaClient;

const ids: Record<string, string> = {};
let user: { id: string; countryCode: string };

beforeAll(async () => {
  copyMigratedDatabase(url);
  db = new PrismaClient({ datasourceUrl: url });

  user = await db.user.create({ data: { email: "searcher@example.test", displayName: "S", countryCode: "CA" } });
  const other = await db.user.create({ data: { email: "other@example.test", displayName: "O" } });
  const [groceries, salary, otherFood, transferCat] = await Promise.all([
    db.category.create({ data: { userId: user.id, name: "Groceries", kind: "EXPENSE" } }),
    db.category.create({ data: { userId: user.id, name: "Salary", kind: "INCOME" } }),
    db.category.create({ data: { userId: other.id, name: "Groceries", kind: "EXPENSE" } }),
    db.category.create({ data: { userId: user.id, name: "Transfer", kind: "TRANSFER" } }),
  ]);
  const [chequing, visa] = await Promise.all([
    db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } }),
    db.account.create({ data: { userId: user.id, name: "Visa card", type: "CREDIT_CARD" } }),
  ]);
  const tag = await db.tag.create({ data: { userId: user.id, name: "Trip", nameKey: "trip" } });

  const txn = (data: Record<string, unknown>) =>
    db.transaction.create({ data: { userId: user.id, categoryId: groceries.id, type: "EXPENSE", accountId: visa.id, ...data } as never });
  ids.oldCoffee = (await txn({ title: "Coffee Corner", amountCents: 450, date: new Date("2024-03-02T00:00:00Z") })).id;
  ids.newCoffee = (await txn({ title: "coffee beans", amountCents: 1899, date: new Date("2026-09-20T00:00:00Z") })).id;
  ids.noteMatch = (await txn({ title: "Market", note: "bought COFFEE filters", amountCents: 1250, date: new Date("2025-07-04T00:00:00Z") })).id;
  ids.refund = (await txn({ title: "Return", amountCents: -1250, date: new Date("2025-08-01T00:00:00Z") })).id;
  ids.pay = (
    await txn({ title: "Payroll", type: "INCOME", categoryId: salary.id, accountId: chequing.id, amountCents: 300000, date: new Date("2026-09-15T00:00:00Z") })
  ).id;
  ids.cardPayment = (
    await txn({
      title: "Visa payment",
      type: "TRANSFER",
      categoryId: transferCat.id,
      accountId: chequing.id,
      transferAccountId: visa.id,
      amountCents: 50000,
      date: new Date("2026-09-25T00:00:00Z"),
    })
  ).id;
  await db.transactionTag.create({ data: { transactionId: ids.oldCoffee, tagId: tag.id } });
  // Someone else's coffee must never show up.
  await db.transaction.create({
    data: { userId: other.id, categoryId: otherFood.id, type: "EXPENSE", title: "Coffee elsewhere", amountCents: 450, date: new Date("2026-01-01T00:00:00Z") },
  });

  ids.recurring = (
    await db.recurringTransaction.create({
      data: {
        userId: user.id,
        accountId: visa.id,
        categoryId: groceries.id,
        type: "EXPENSE",
        name: "Coffee subscription",
        amountCents: 2200,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-11-03T00:00:00Z"),
      },
    })
  ).id;
  ids.tag = tag.id;
  ids.visa = visa.id;
  ids.chequing = chequing.id;
  ids.groceries = groceries.id;
  await db.transactionRule.create({ data: { userId: user.id, priority: 1, titleOperator: "CONTAINS", titlePattern: "coffee", setCategoryId: groceries.id } });
  await db.savingsGoal.create({ data: { userId: user.id, name: "Coffee machine", targetCents: 80000 } });
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

function hitIds(results: Awaited<ReturnType<typeof searchUserData>>, kind: string) {
  return results.groups.find((g) => g.kind === kind)?.hits.map((h) => h.id) ?? [];
}

describe("searchUserData", () => {
  it("finds transactions from every month by title or note, ignoring case, newest first, only the user's own", async () => {
    const results = await searchUserData(db, user, "coffee");
    expect(hitIds(results, "transaction")).toEqual([ids.newCoffee, ids.noteMatch, ids.oldCoffee]);
    expect(results.transactionTotal).toBe(3);
    const hit = results.groups.find((g) => g.kind === "transaction")!.hits[2];
    expect(hit.href).toBe(`/?month=2024-03&open=${ids.oldCoffee}`);
    expect(hit.detail).toContain("Groceries");
  });

  it("finds the user's other things by name", async () => {
    const results = await searchUserData(db, user, "coffee");
    expect(hitIds(results, "recurring")).toEqual([ids.recurring]);
    expect(results.groups.find((g) => g.kind === "recurring")!.hits[0].href).toBe(`/?month=2026-11&open=${ids.recurring}`);
    expect(hitIds(results, "rule")).toHaveLength(1);
    expect(hitIds(results, "goal")).toHaveLength(1);
    expect(hitIds(results, "category")).toEqual([]);

    const byName = await searchUserData(db, user, "groc");
    expect(byName.groups.find((g) => g.kind === "category")!.hits.map((h) => h.href)).toEqual([`/search?category=${ids.groceries}`]);
    expect(hitIds(await searchUserData(db, user, "visa"), "account")).toEqual([ids.visa]);
    expect(hitIds(await searchUserData(db, user, "tri"), "tag")).toEqual([ids.tag]);
  });

  it("finds a charge and its refund by amount", async () => {
    const results = await searchUserData(db, user, "12.50");
    expect(hitIds(results, "transaction").sort()).toEqual([ids.noteMatch, ids.refund].sort());
  });

  it("keeps transfers in a group of their own, described from one account to the other", async () => {
    const results = await searchUserData(db, user, "payment");
    expect(hitIds(results, "transaction")).toEqual([]);
    expect(hitIds(results, "transfer")).toEqual([ids.cardPayment]);
    expect(results.groups.find((g) => g.kind === "transfer")!.hits[0].detail).toContain("Chequing → Visa card");
  });

  it("does not search on one letter", async () => {
    expect(await searchUserData(db, user, " c ")).toEqual({ groups: [], transactionTotal: 0 });
  });
});

describe("transactionSearchWhere", () => {
  const find = (filter: Parameters<typeof transactionSearchWhere>[1]) =>
    db.transaction.findMany({ where: transactionSearchWhere(user.id, filter), select: { id: true } }).then((rows) => rows.map((r) => r.id).sort());

  it("counts a transfer under both of its accounts", async () => {
    expect(await find({ accountId: ids.chequing })).toEqual([ids.pay, ids.cardPayment].sort());
    expect(await find({ accountId: ids.visa })).toContain(ids.cardPayment);
  });

  it("narrows by tag, type and category together with the text", async () => {
    expect(await find({ tagId: ids.tag })).toEqual([ids.oldCoffee]);
    expect(await find({ query: "coffee", type: "EXPENSE", categoryId: ids.groceries })).toHaveLength(3);
    expect(await find({ query: "coffee", type: "INCOME" })).toEqual([]);
  });
});
