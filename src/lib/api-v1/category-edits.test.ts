import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Settings → Categories, Suggest budgets and tidying tags for the phone, against a real SQLite database. */

const dir = mkdtempSync(join(tmpdir(), "api-category-edits-"));
const url = `file:${join(dir, "categories.db")}`;
let db: PrismaClient;
let api: typeof import("./category-edits");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./category-edits");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; timezone: string; countryCode: string | null };

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `categories${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
});

async function category(name: string, kind: "expense" | "income" = "expense", limitCents?: number): Promise<string> {
  const result = await api.createCategoryFromApi(db, user, { name, kind, ...(limitCents ? { limitCents } : {}) });
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

const entry = (categoryId: string, title = "Shop") =>
  db.transaction.create({ data: { userId: user.id, type: "EXPENSE", amountCents: 1_000, categoryId, title, date: new Date() } });

describe("categories", () => {
  it("adds one with a budget, refuses a second of the same name, and files it under a group as a need", async () => {
    const groceries = await category("Groceries", "expense", 40_000);
    expect(await db.budget.findMany({ where: { categoryId: groceries }, select: { limitCents: true } })).toEqual([{ limitCents: 40_000 }]);
    expect(await api.createCategoryFromApi(db, user, { name: " groceries ", kind: "expense" })).toEqual({
      ok: false,
      status: 400,
      error: "You already have a category called “groceries”.",
    });
    expect(await api.createCategoryFromApi(db, user, { name: "Pay", kind: "income", limitCents: 100 })).toMatchObject({ ok: false, status: 400 });

    const dining = await category("Dining");
    expect(await api.patchCategoryFromApi(db, user, groceries, { groupName: "Food" })).toMatchObject({ ok: true, mergedInto: null });
    // "food" joins the group already called "Food".
    expect(await api.patchCategoryFromApi(db, user, dining, { groupName: "food", spendingRole: "want" })).toMatchObject({ ok: true });
    const pay = await category("Pay", "income");
    expect(await api.patchCategoryFromApi(db, user, pay, { spendingRole: "need" })).toEqual({
      ok: false,
      status: 400,
      error: "Only spending categories are needs or wants.",
    });

    await entry(dining);
    const details = await api.loadCategoryDetails(db, user.id);
    expect(details.filter((c) => c.kind === "expense").map(({ name, groupName, spendingRole, uses }) => ({ name, groupName, spendingRole, uses }))).toEqual([
      { name: "Dining", groupName: "Food", spendingRole: "want", uses: 1 },
      { name: "Groceries", groupName: "Food", spendingRole: null, uses: 0 },
    ]);
  });

  it("merges on a rename into another's name, and deletes one in use only with somewhere for its entries to go", async () => {
    const dining = await category("Dining");
    const eatingOut = await category("Eating out");
    const gas = await category("Gas");
    await entry(eatingOut);
    await entry(gas);

    expect(await api.patchCategoryFromApi(db, user, eatingOut, { name: "dining" })).toEqual({
      ok: true,
      id: dining,
      mergedInto: { id: dining, name: "Dining" },
    });
    expect(await db.category.count({ where: { id: eatingOut } })).toBe(0);
    expect(await db.transaction.count({ where: { userId: user.id, categoryId: dining } })).toBe(1);

    expect(await api.deleteCategoryFromApi(db, user, gas, null)).toEqual({
      ok: false,
      status: 400,
      error: "This category is in use. Choose a category to move its transactions to.",
    });
    expect(await api.deleteCategoryFromApi(db, user, gas, dining)).toEqual({ ok: true });
    expect(await db.transaction.count({ where: { userId: user.id, categoryId: dining } })).toBe(2);
    expect(await api.deleteCategoryFromApi(db, user, dining, null)).toMatchObject({ ok: false, error: "Keep at least one expense category." });
    expect(await api.deleteCategoryFromApi(db, user, "nope", null)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("Suggest budgets", () => {
  it("sets the ticked budgets from this month on, and refuses a category that is not the user's", async () => {
    const groceries = await category("Groceries");
    const result = await api.applyBudgetSuggestionsFromApi(db, user, { budgets: [{ categoryId: groceries, limitCents: 45_000 }] });
    expect(result).toEqual({ ok: true, set: 1 });
    const suggestions = await api.loadAppBudgetSuggestions(db, user);
    expect(suggestions.currentBudgets).toEqual([{ categoryId: groceries, limitCents: 45_000 }]);
    expect(suggestions.sets.map((s) => s.window)).toEqual([3, 6]);

    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.category.create({ data: { userId: other.id, name: "Theirs", kind: "EXPENSE" } });
    expect(await api.applyBudgetSuggestionsFromApi(db, user, { budgets: [{ categoryId: theirs.id, limitCents: 100 }] })).toEqual({
      ok: false,
      status: 400,
      error: "A suggested category no longer exists. Reload and try again.",
    });
    expect(await api.applyBudgetSuggestionsFromApi(db, user, { budgets: [] })).toMatchObject({ ok: false, error: "Tick at least one budget to set." });
  });
});

describe("tags", () => {
  it("renames one, merges it into another of the same name with its entries, and deletes one", async () => {
    const food = await category("Food");
    const tag = (name: string) => db.tag.create({ data: { userId: user.id, name, nameKey: name.toLowerCase() } });
    const trip = await tag("Trip");
    const trips = await tag("trips");
    const tx = await entry(food);
    await db.transactionTag.create({ data: { transactionId: tx.id, tagId: trips.id } });

    expect(await api.patchTagFromApi(db, user.id, trip.id, { name: "Vacation" })).toEqual({ ok: true, id: trip.id, mergedInto: null });
    expect(await api.patchTagFromApi(db, user.id, trips.id, { name: "vacation" })).toEqual({
      ok: true,
      id: trip.id,
      mergedInto: { id: trip.id, name: "Vacation" },
    });
    expect(await db.transactionTag.findMany({ where: { transactionId: tx.id }, select: { tagId: true } })).toEqual([{ tagId: trip.id }]);

    expect(await api.deleteTagFromApi(db, user.id, trip.id)).toEqual({ ok: true });
    expect(await db.tag.count({ where: { userId: user.id } })).toBe(0);
    expect(await api.deleteTagFromApi(db, user.id, trip.id)).toEqual({ ok: false, status: 404, error: "Tag not found." });
  });
});
