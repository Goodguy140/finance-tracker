import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Rules made from the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-transaction-rules-"));
const url = `file:${join(dir, "rules.db")}`;
let db: PrismaClient;
let api: typeof import("./transaction-rules");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./transaction-rules");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let coffee: string;
let food: string;
let pay: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `rules${seq}@example.test`, displayName: "Test" } })).id;
  coffee = (await db.category.create({ data: { userId, name: "Coffee", kind: "EXPENSE" } })).id;
  food = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
  pay = (await db.category.create({ data: { userId, name: "Pay", kind: "INCOME" } })).id;
});

function entry(categoryId: string, title: string, day: string, type: "EXPENSE" | "INCOME" = "EXPENSE") {
  return db.transaction.create({
    data: { userId, categoryId, type, amountCents: 500, date: new Date(`2026-10-${day}T00:00:00Z`), title },
  });
}

describe("a rule made on the phone", () => {
  it("is added after the others, says how many past entries it fits, and applies to them", async () => {
    await db.transactionRule.create({ data: { userId, priority: 4, titleOperator: "CONTAINS", titlePattern: "rent", setCategoryId: food } });
    const wrong = await entry(food, "Tim Hortons", "01");
    const already = await entry(coffee, "Tim Hortons", "02");
    const other = await entry(food, "Tim Hortons Cafe", "03");

    const made = await api.createTransactionRuleFromApi(db, userId, { match: "is", texts: ["Tim Hortons"], categoryId: coffee, tag: "Treats" });
    expect(made).toMatchObject({ ok: true, matches: 2 });
    if (!made.ok) return;
    const rule = await db.transactionRule.findUniqueOrThrow({ where: { id: made.id } });
    expect(rule).toMatchObject({ titleOperator: "EQUALS", titlePattern: "Tim Hortons", transactionType: "EXPENSE", setCategoryId: coffee, priority: 5 });
    expect((await db.tag.findUniqueOrThrow({ where: { id: rule.addTagId! } })).name).toBe("Treats");

    expect(await api.applyTransactionRuleFromApi(db, userId, made.id)).toEqual({ ok: true, updated: 2 });
    const rows = await db.transaction.findMany({ where: { id: { in: [wrong.id, already.id, other.id] } }, include: { tags: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(wrong.id)).toMatchObject({ categoryId: coffee });
    expect(byId.get(wrong.id)?.tags).toHaveLength(1);
    // Already filed there, it only gains the tag; "Tim Hortons Cafe" is not exactly the title.
    expect(byId.get(already.id)?.tags).toHaveLength(1);
    expect(byId.get(other.id)).toMatchObject({ categoryId: food });
    expect(byId.get(other.id)?.tags).toHaveLength(0);
  });

  it("refuses a rule that sets nothing, another person's category, and an unknown rule", async () => {
    expect(await api.createTransactionRuleFromApi(db, userId, { texts: ["Tim"] })).toEqual({
      ok: false,
      status: 400,
      error: "Choose at least one thing for the rule to set.",
    });
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.category.create({ data: { userId: other.id, name: "Theirs", kind: "EXPENSE" } });
    expect(await api.createTransactionRuleFromApi(db, userId, { texts: ["Tim"], categoryId: theirs.id })).toEqual({
      ok: false,
      status: 400,
      error: "Selected category was not found.",
    });
    expect(await api.createTransactionRuleFromApi(db, userId, { texts: ["Tim"], type: "income", categoryId: coffee })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await api.applyTransactionRuleFromApi(db, userId, "no-such-rule")).toEqual({ ok: false, status: 404, error: "Rule not found." });
    expect(await db.transactionRule.count({ where: { userId } })).toBe(0);
  });
});

describe("rule suggestions", () => {
  it("offers each expense title's latest category that no rule decides, until hidden", async () => {
    await entry(food, "Tim Hortons", "01");
    await entry(coffee, "Tim Hortons", "05");
    await entry(food, "Superstore", "03");
    await entry(food, "Rent", "04");
    await entry(pay, "Payroll", "06", "INCOME");
    await db.transactionRule.create({ data: { userId, priority: 0, titleOperator: "CONTAINS", titlePattern: "rent", setCategoryId: food } });

    const before = await api.loadRuleSuggestions(db, userId);
    expect(before.suggestions).toEqual([
      { title: "Tim Hortons", categoryId: coffee, categoryName: "Coffee" },
      { title: "Superstore", categoryId: food, categoryName: "Food" },
    ]);
    expect(before.total).toBe(2);

    expect(await api.hideRuleSuggestionFromApi(db, userId, { title: " tim hortons " })).toEqual({ ok: true });
    expect((await api.loadRuleSuggestions(db, userId)).suggestions.map((s) => s.title)).toEqual(["Superstore"]);
  });
});
