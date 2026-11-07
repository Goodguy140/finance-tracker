import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The category trend and payee pages for the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-category-merchant-"));
const url = `file:${join(dir, "trend.db")}`;
let db: PrismaClient;
let api: typeof import("./category-merchant");
let data: typeof import("@/lib/reports/category-merchant-data");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./category-merchant");
  data = await import("@/lib/reports/category-merchant-data");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// This month and the one before, in UTC as the test user's time zone is.
const now = new Date();
const thisYm = now.toISOString().slice(0, 7);
const lastYm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

let seq = 0;
let user: { id: string; timezone: string; countryCode: string };
let food: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `trend${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  food = (await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE", groupName: "Living" } })).id;
});

function spend(categoryId: string, amountCents: number, ym: string, day: string, title: string) {
  return db.transaction.create({
    data: { userId: user.id, categoryId, type: "EXPENSE", amountCents, date: new Date(`${ym}-${day}T00:00:00Z`), title },
  });
}

describe("a category's page", () => {
  it("gives its months against the budget, its top payees and its biggest entries", async () => {
    await db.budget.create({ data: { userId: user.id, categoryId: food, periodMonth: lastYm, limitCents: 30_000 } });
    await spend(food, 20_000, lastYm, "05", "Superstore");
    await spend(food, 15_000, lastYm, "20", "Corner Cafe");
    await spend(food, 9_000, thisYm, "01", "Superstore");

    const loaded = await data.loadCategoryTrend(user, food, db);
    const trend = api.serializeCategoryTrend(loaded!);
    expect(trend).toMatchObject({ categoryId: food, name: "Food", kind: "expense", groupName: "Living", currency: "CAD" });
    expect(trend.months.map(({ month, cents, budgetCents }) => ({ month, cents, budgetCents }))).toEqual([
      { month: lastYm, cents: 35_000, budgetCents: 30_000 },
      // The budget rolls forward into this month.
      { month: thisYm, cents: 9_000, budgetCents: 30_000 },
    ]);
    expect(trend.thisMonth).toMatchObject({ cents: 9_000, budgetCents: 30_000 });
    expect(trend.averageCents).toBe(35_000);
    expect(trend.payees.map(({ label, cents, count }) => ({ label, cents, count }))).toEqual([
      { label: "Superstore", cents: 29_000, count: 2 },
      { label: "Corner Cafe", cents: 15_000, count: 1 },
    ]);
    expect(trend.biggest[0]).toMatchObject({ title: "Superstore", cents: 20_000, date: `${lastYm}-05`, split: false });
  });

  it("is empty for a category with nothing in it, and missing for another person's or a transfer category", async () => {
    const empty = api.serializeCategoryTrend((await data.loadCategoryTrend(user, food, db))!);
    expect(empty).toMatchObject({ months: [], thisMonth: null, payees: [], biggest: [], averageCents: null });

    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.category.create({ data: { userId: other.id, name: "Theirs", kind: "EXPENSE" } });
    const transfers = await db.category.create({ data: { userId: user.id, name: "Transfers", kind: "TRANSFER" } });
    expect(await data.loadCategoryTrend(user, theirs.id, db)).toBeNull();
    expect(await data.loadCategoryTrend(user, transfers.id, db)).toBeNull();
  });
});

describe("a payee's page", () => {
  it("opens from a category's payee key, newest first, and lists only as many entries as asked", async () => {
    const fun = (await db.category.create({ data: { userId: user.id, name: "Fun", kind: "EXPENSE" } })).id;
    await spend(food, 20_000, lastYm, "05", "Superstore");
    await spend(fun, 4_000, lastYm, "12", "Superstore");
    await spend(food, 9_000, thisYm, "01", "Superstore");
    const trend = api.serializeCategoryTrend((await data.loadCategoryTrend(user, food, db))!);
    const key = trend.payees[0].key;

    const merchant = api.serializeMerchant((await data.loadMerchantActivity(user, key))!, 2);
    expect(merchant).toMatchObject({
      label: "Superstore",
      currency: "CAD",
      firstDate: `${lastYm}-05`,
      lastDate: `${thisYm}-01`,
      spentCents: 33_000,
      receivedCents: 0,
      count: 3,
      averageCents: 11_000,
    });
    expect(merchant.months.map((m) => [m.month, m.spentCents])).toEqual([
      [lastYm, 24_000],
      [thisYm, 9_000],
    ]);
    expect(merchant.categories).toEqual([
      { categoryName: "Food", spentCents: 29_000 },
      { categoryName: "Fun", spentCents: 4_000 },
    ]);
    // Two of the three, newest first.
    expect(merchant.transactions.map((t) => [t.date, t.amountCents, t.categoryName])).toEqual([
      [`${thisYm}-01`, 9_000, "Food"],
      [`${lastYm}-12`, 4_000, "Fun"],
    ]);
    expect(await data.loadMerchantActivity(user, "nobody at all")).toBeNull();
  });
});
