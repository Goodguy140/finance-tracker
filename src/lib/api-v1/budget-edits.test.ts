import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Budget changes from the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-budget-edits-"));
const url = `file:${join(dir, "budgets.db")}`;
let db: PrismaClient;
let api: typeof import("./budget-edits");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./budget-edits");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const now = new Date();
const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const lastMonth = (() => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
})();

let seq = 0;
let user: { id: string; timezone: string };
let foodId: string;
let groceriesId: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `budget${seq}@example.test`, displayName: "Test", timezone: "UTC" },
    select: { id: true, timezone: true },
  });
  foodId = (await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } })).id;
  groceriesId = (await db.category.create({ data: { userId: user.id, name: "Groceries", kind: "EXPENSE" } })).id;
});

function budgets(categoryId: string) {
  return db.budget.findMany({ where: { categoryId }, orderBy: { periodMonth: "asc" }, select: { periodMonth: true, limitCents: true } });
}

async function spend(categoryId: string, amountCents: number) {
  await db.transaction.create({
    data: { userId: user.id, categoryId, type: "EXPENSE", amountCents, date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12)) },
  });
}

describe("patchBudgetFromApi", () => {
  it("sets the monthly budget from this month on, leaving earlier months, and the yearly one for this year", async () => {
    await db.budget.create({ data: { userId: user.id, categoryId: foodId, periodMonth: lastMonth, limitCents: 30_000 } });

    expect(await api.patchBudgetFromApi(db, user, foodId, { monthlyCents: 45_000, yearlyCents: 120_000 })).toEqual({ ok: true });
    expect(await budgets(foodId)).toEqual([
      { periodMonth: lastMonth, limitCents: 30_000 },
      { periodMonth: thisMonth, limitCents: 45_000 },
    ]);
    expect(await db.yearlyBudget.findMany({ where: { categoryId: foodId }, select: { year: true, limitCents: true } })).toEqual([
      { year: now.getUTCFullYear(), limitCents: 120_000 },
    ]);
  });

  it("turns rollover on only with a budget, and removing the budget removes every month and rollover", async () => {
    expect(await api.patchBudgetFromApi(db, user, foodId, { rollover: true })).toEqual({
      ok: false,
      status: 400,
      error: "Set a monthly budget before turning on rollover.",
    });
    await db.budget.create({ data: { userId: user.id, categoryId: foodId, periodMonth: lastMonth, limitCents: 30_000 } });
    expect(await api.patchBudgetFromApi(db, user, foodId, { monthlyCents: 40_000, rollover: true })).toEqual({ ok: true });
    expect((await db.category.findUniqueOrThrow({ where: { id: foodId } })).rolloverSinceMonth).toBe(thisMonth);

    expect(await api.patchBudgetFromApi(db, user, foodId, { monthlyCents: null })).toEqual({ ok: true });
    expect(await budgets(foodId)).toEqual([]);
    expect((await db.category.findUniqueOrThrow({ where: { id: foodId } })).rolloverSinceMonth).toBeNull();
  });

  it("refuses an income category, another person's, a zero limit and an empty request", async () => {
    const salary = (await db.category.create({ data: { userId: user.id, name: "Salary", kind: "INCOME" } })).id;
    expect(await api.patchBudgetFromApi(db, user, salary, { monthlyCents: 100 })).toMatchObject({ ok: false, status: 400 });
    const other = await db.user.create({ data: { email: `budget-other${seq}@example.test`, displayName: "Other", timezone: "UTC" } });
    expect(await api.patchBudgetFromApi(db, other, foodId, { monthlyCents: 100 })).toMatchObject({ ok: false, status: 404 });
    expect(await api.patchBudgetFromApi(db, user, foodId, { monthlyCents: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(await api.patchBudgetFromApi(db, user, foodId, {})).toMatchObject({ ok: false, status: 400 });
    expect(await budgets(foodId)).toEqual([]);
  });
});

describe("coverBudgetFromApi", () => {
  beforeEach(async () => {
    await db.budget.create({ data: { userId: user.id, categoryId: foodId, periodMonth: lastMonth, limitCents: 10_000 } });
    await db.budget.create({ data: { userId: user.id, categoryId: groceriesId, periodMonth: lastMonth, limitCents: 20_000 } });
    await spend(foodId, 13_000);
    await spend(groceriesId, 5_000);
  });

  it("raises the overspent budget this month by what the others give", async () => {
    expect(await api.coverBudgetFromApi(db, user, foodId, { from: [{ categoryId: groceriesId, amountCents: 3_000 }] })).toEqual({ ok: true });
    expect(await budgets(foodId)).toEqual([
      { periodMonth: lastMonth, limitCents: 10_000 },
      { periodMonth: thisMonth, limitCents: 13_000 },
    ]);
    expect(await budgets(groceriesId)).toEqual([
      { periodMonth: lastMonth, limitCents: 20_000 },
      { periodMonth: thisMonth, limitCents: 17_000 },
    ]);
  });

  it("refuses more than the overage, more than a budget's room, and a budget that is not over", async () => {
    expect(await api.coverBudgetFromApi(db, user, foodId, { from: [{ categoryId: groceriesId, amountCents: 4_000 }] })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await api.coverBudgetFromApi(db, user, groceriesId, { from: [{ categoryId: foodId, amountCents: 100 }] })).toMatchObject({
      ok: false,
      status: 400,
      error: "Groceries is no longer over budget.",
    });
    expect(await api.coverBudgetFromApi(db, user, foodId, { from: [] })).toMatchObject({ ok: false, status: 400 });
    expect((await budgets(foodId)).map((b) => b.limitCents)).toEqual([10_000]);
  });
});
