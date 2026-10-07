import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Category management against a real SQLite database built from the migrations: merging
 * must move every reference (a missed one is a Restrict error or a silently orphaned row),
 * and a Plaid mapping must change what the review queue proposes.
 */

const dir = mkdtempSync(join(tmpdir(), "categories-"));
const url = `file:${join(dir, "categories.db")}`;
let db: PrismaClient;
let actions: typeof import("./categories");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId, timezone: "America/Toronto" })),
}));

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./categories");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let accountId: string;

beforeEach(async () => {
  seq += 1;
  session.userId = (await db.user.create({ data: { email: `c${seq}@example.test`, displayName: "Test" } })).id;
  accountId = (await db.account.create({ data: { userId: session.userId, name: "Visa", type: "CREDIT_CARD" } })).id;
});

const category = (name: string, kind: "EXPENSE" | "INCOME" = "EXPENSE") =>
  db.category.create({ data: { userId: session.userId, name, kind } });

const expense = (categoryId: string) =>
  db.transaction.create({
    data: {
      userId: session.userId,
      accountId,
      categoryId,
      type: "EXPENSE",
      amountCents: 1000,
      date: new Date("2026-09-10T00:00:00Z"),
      title: "Lunch",
    },
  });

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function expectOk(result: Promise<unknown>) {
  expect(await result).toBeUndefined();
}

async function stagedRow(categoryId: string | null, pfc: { primary: string; detailed: string }) {
  const item = await db.plaidItem.create({
    data: {
      userId: session.userId,
      itemId: `item-${seq}-${Math.random()}`,
      accessTokenEnc: "x",
      requestedDays: 90,
      historyCutoff: new Date("2026-06-01T00:00:00Z"),
    },
  });
  const plaidAccount = await db.plaidAccount.create({
    data: {
      userId: session.userId,
      plaidItemId: item.id,
      plaidAccountId: `pa-${item.id}`,
      name: "Chequing",
      plaidType: "depository",
      accountId,
    },
  });
  return db.plaidStagedTransaction.create({
    data: {
      userId: session.userId,
      plaidItemId: item.id,
      plaidAccountRowId: plaidAccount.id,
      plaidTransactionId: `ptx-${item.id}`,
      name: "LOBLAWS",
      amountCents: 4200,
      type: "EXPENSE",
      date: new Date("2026-09-12T00:00:00Z"),
      pfcPrimary: pfc.primary,
      pfcDetailed: pfc.detailed,
      suggestedCategoryId: categoryId,
    },
  });
}

describe("createCategoryAction", () => {
  it("adds a category with a budget from this month on, and refuses a duplicate name", async () => {
    await expectOk(actions.createCategoryAction(form({ name: "Pets", kind: "EXPENSE", limit: "75" })));
    const pets = await db.category.findFirstOrThrow({ where: { userId: session.userId, name: "Pets" } });
    const budgets = await db.budget.findMany({ where: { categoryId: pets.id } });
    expect(budgets.map((b) => b.limitCents)).toEqual([7500]);

    const again = await actions.createCategoryAction(form({ name: "pets", kind: "EXPENSE" }));
    expect(again).toMatchObject({ ok: false });
    // The same name is fine for the other kind: they are separate pickers.
    await expectOk(actions.createCategoryAction(form({ name: "Pets", kind: "INCOME" })));
  });
});

describe("renameCategoryAction", () => {
  it("renames, and merges when the new name is another category's", async () => {
    const coffee = await category("Coffee");
    const dining = await category("Dining");
    await expectOk(actions.renameCategoryAction(form({ categoryId: coffee.id, name: "Cafés" })));
    expect((await db.category.findUniqueOrThrow({ where: { id: coffee.id } })).name).toBe("Cafés");

    const tx = await expense(coffee.id);
    await expectOk(actions.renameCategoryAction(form({ categoryId: coffee.id, name: "dining" })));
    expect(await db.category.findUnique({ where: { id: coffee.id } })).toBeNull();
    expect((await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId).toBe(dining.id);
  });
});

describe("mergeCategoryAction", () => {
  it("moves every reference onto the target and keeps the target's budget where both have one", async () => {
    const from = await category("Coffee");
    const to = await category("Dining");
    const tx = await expense(from.id);
    await db.splitTransactionPart.create({ data: { userId: session.userId, transactionId: tx.id, categoryId: from.id, amountCents: 500 } });
    const recurring = await db.recurringTransaction.create({
      data: {
        userId: session.userId,
        accountId,
        categoryId: from.id,
        type: "EXPENSE",
        name: "Beans",
        amountCents: 2000,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-10-01T00:00:00Z"),
      },
    });
    const rule = await db.transactionRule.create({
      data: { userId: session.userId, priority: 1, titleOperator: "CONTAINS", titlePattern: "cafe", setCategoryId: from.id },
    });
    await db.plaidCategoryMapping.create({
      data: { userId: session.userId, plaidCategory: "FOOD_AND_DRINK_COFFEE", categoryId: from.id },
    });
    const staged = await stagedRow(from.id, { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" });
    await db.budget.createMany({
      data: [
        { userId: session.userId, categoryId: from.id, periodMonth: "2026-08", limitCents: 5000 },
        { userId: session.userId, categoryId: from.id, periodMonth: "2026-09", limitCents: 6000 },
        { userId: session.userId, categoryId: to.id, periodMonth: "2026-09", limitCents: 30000 },
      ],
    });

    await expectOk(actions.mergeCategoryAction(form({ categoryId: from.id, targetCategoryId: to.id })));

    expect(await db.category.findUnique({ where: { id: from.id } })).toBeNull();
    expect((await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId).toBe(to.id);
    expect((await db.splitTransactionPart.findFirstOrThrow({ where: { transactionId: tx.id } })).categoryId).toBe(to.id);
    expect((await db.recurringTransaction.findUniqueOrThrow({ where: { id: recurring.id } })).categoryId).toBe(to.id);
    expect((await db.transactionRule.findUniqueOrThrow({ where: { id: rule.id } })).setCategoryId).toBe(to.id);
    expect((await db.plaidCategoryMapping.findFirstOrThrow({ where: { userId: session.userId } })).categoryId).toBe(to.id);
    expect((await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: staged.id } })).suggestedCategoryId).toBe(
      to.id,
    );
    const budgets = await db.budget.findMany({ where: { categoryId: to.id }, orderBy: { periodMonth: "asc" } });
    expect(budgets.map((b) => [b.periodMonth, b.limitCents])).toEqual([
      ["2026-08", 5000],
      ["2026-09", 30000],
    ]);
  });

  it("refuses to merge an expense category into an income one", async () => {
    const from = await category("Coffee");
    const to = await category("Salary", "INCOME");
    expect(await actions.mergeCategoryAction(form({ categoryId: from.id, targetCategoryId: to.id }))).toMatchObject({
      ok: false,
    });
    expect(await db.category.findUnique({ where: { id: from.id } })).not.toBeNull();
  });
});

describe("deleteCategoryAction", () => {
  it("deletes an unused category with its budgets, but asks where a used one's transactions go", async () => {
    const unused = await category("Unused");
    const used = await category("Used");
    const keep = await category("Keep");
    await db.budget.create({ data: { userId: session.userId, categoryId: unused.id, periodMonth: "2026-09", limitCents: 100 } });
    const tx = await expense(used.id);

    await expectOk(actions.deleteCategoryAction(form({ categoryId: unused.id })));
    expect(await db.category.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(await db.budget.count({ where: { userId: session.userId } })).toBe(0);

    expect(await actions.deleteCategoryAction(form({ categoryId: used.id }))).toMatchObject({ ok: false });
    expect(await db.category.findUnique({ where: { id: used.id } })).not.toBeNull();

    await expectOk(actions.deleteCategoryAction(form({ categoryId: used.id, targetCategoryId: keep.id })));
    expect((await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId).toBe(keep.id);
  });

  it("keeps the last category of a kind", async () => {
    const only = await category("Only");
    expect(await actions.deleteCategoryAction(form({ categoryId: only.id }))).toMatchObject({ ok: false });
  });
});

describe("setCategoryBudgetAction", () => {
  it("sets this month's limit and removes every row on request", async () => {
    const food = await category("Food");
    await db.budget.create({ data: { userId: session.userId, categoryId: food.id, periodMonth: "2026-01", limitCents: 100 } });
    await expectOk(actions.setCategoryBudgetAction(form({ categoryId: food.id, intent: "set", limit: "250" })));
    const rows = await db.budget.findMany({ where: { categoryId: food.id }, orderBy: { periodMonth: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[1].limitCents).toBe(25000);

    expect(await actions.setCategoryBudgetAction(form({ categoryId: food.id, intent: "set", limit: "" }))).toMatchObject({
      ok: false,
    });
    await expectOk(actions.setCategoryBudgetAction(form({ categoryId: food.id, intent: "remove" })));
    expect(await db.budget.count({ where: { categoryId: food.id } })).toBe(0);
  });
});

describe("setPlaidCategoryMappingAction", () => {
  it("re-suggests rows waiting for review, and returns them to the default when cleared", async () => {
    const dining = await category("Dining");
    const groceries = await category("Groceries");
    const staged = await stagedRow(dining.id, { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" });

    await expectOk(
      actions.setPlaidCategoryMappingAction(form({ plaidCategory: "FOOD_AND_DRINK_GROCERIES", categoryId: groceries.id })),
    );
    expect((await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: staged.id } })).suggestedCategoryId).toBe(
      groceries.id,
    );

    await expectOk(actions.setPlaidCategoryMappingAction(form({ plaidCategory: "FOOD_AND_DRINK_GROCERIES", categoryId: "" })));
    expect(await db.plaidCategoryMapping.count({ where: { userId: session.userId } })).toBe(0);
    expect((await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: staged.id } })).suggestedCategoryId).toBe(
      dining.id,
    );
  });

  it("refuses an unknown code and a category of the wrong kind", async () => {
    const salary = await category("Salary", "INCOME");
    const fun = await category("Fun");
    expect(
      await actions.setPlaidCategoryMappingAction(form({ plaidCategory: "NOT_A_CODE", categoryId: fun.id })),
    ).toMatchObject({ ok: false });
    expect(
      await actions.setPlaidCategoryMappingAction(form({ plaidCategory: "FOOD_AND_DRINK", categoryId: salary.id })),
    ).toMatchObject({ ok: false });
    expect(
      await actions.setPlaidCategoryMappingAction(form({ plaidCategory: "INCOME_WAGES", categoryId: fun.id })),
    ).toMatchObject({ ok: false });
    expect(await db.plaidCategoryMapping.count({ where: { userId: session.userId } })).toBe(0);
  });
});
