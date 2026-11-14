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

describe("changing a rule from the phone", () => {
  it("changes only what it is sent, and keeps what only the website edits", async () => {
    const tag = await db.tag.create({ data: { userId, name: "Treats", nameKey: "treats" } });
    const rule = await db.transactionRule.create({
      data: {
        userId,
        priority: 0,
        titleOperator: "CONTAINS",
        titlePattern: "tim",
        transactionType: "EXPENSE",
        minAmountCents: 300,
        appendNote: "coffee run",
        addTagId: tag.id,
        splits: { create: [{ position: 0, categoryId: coffee, basisPoints: 7000 }, { position: 1, categoryId: food, basisPoints: 3000 }] },
      },
    });
    const user = { id: userId, countryCode: "CA" };
    const listed = (await api.loadAppRules(db, user)).rules[0];
    expect(listed).toMatchObject({
      id: rule.id,
      position: 1,
      enabled: true,
      match: "contains",
      texts: ["tim"],
      type: "expense",
      categoryId: null,
      tag: "Treats",
      alsoOnWebsite: ["an amount range", "a split", "a note"],
    });
    expect(listed.condition).toBe("Title contains “tim”, expenses only, amount ≥ $3.00");

    const changed = await api.patchTransactionRuleFromApi(db, userId, rule.id, { match: "is", texts: ["Tim Hortons", "Tims"], rename: "Tim Hortons" });
    expect(changed).toEqual({ ok: true, changedRule: true });
    const saved = await db.transactionRule.findUniqueOrThrow({ where: { id: rule.id }, include: { splits: { orderBy: { position: "asc" } } } });
    expect(saved).toMatchObject({
      titleOperator: "EQUALS",
      titlePattern: "Tim Hortons\nTims",
      setTitle: "Tim Hortons",
      transactionType: "EXPENSE",
      minAmountCents: 300,
      appendNote: "coffee run",
      addTagId: tag.id,
      priority: 0,
    });
    expect(saved.splits.map((s) => [s.categoryId, s.basisPoints])).toEqual([[coffee, 7000], [food, 3000]]);

    // Clearing the tag from the phone clears only the tag.
    expect(await api.patchTransactionRuleFromApi(db, userId, rule.id, { tag: null })).toMatchObject({ ok: true });
    expect(await db.transactionRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ addTagId: null, appendNote: "coffee run" });
  });

  it("turns a rule off, refuses a change that does not fit, reorders, and deletes", async () => {
    const make = (priority: number, titlePattern: string) =>
      db.transactionRule.create({ data: { userId, priority, titleOperator: "CONTAINS", titlePattern, setCategoryId: coffee, transactionType: "EXPENSE" } });
    const [a, b, c] = [await make(0, "a"), await make(1, "b"), await make(2, "c")];

    expect(await api.patchTransactionRuleFromApi(db, userId, a.id, { enabled: false })).toEqual({ ok: true, changedRule: false });
    expect((await db.transactionRule.findUniqueOrThrow({ where: { id: a.id } })).enabled).toBe(false);

    // An income rule cannot file into an expense category; nothing is saved, not even `enabled`.
    expect(await api.patchTransactionRuleFromApi(db, userId, a.id, { type: "income", enabled: true })).toMatchObject({ ok: false, status: 400 });
    expect(await db.transactionRule.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ transactionType: "EXPENSE", enabled: false });
    expect(await api.patchTransactionRuleFromApi(db, userId, a.id, {})).toMatchObject({ ok: false, status: 400 });
    expect(await api.patchTransactionRuleFromApi(db, userId, a.id, { colour: "red" })).toMatchObject({ ok: false, status: 400 });

    const other = await db.user.create({ data: { email: `move${seq}@example.test`, displayName: "Other" } });
    expect(await api.patchTransactionRuleFromApi(db, other.id, a.id, { enabled: true })).toEqual({ ok: false, status: 404, error: "Rule not found." });
    expect(await api.deleteTransactionRuleFromApi(db, other.id, a.id)).toMatchObject({ ok: false, status: 404 });

    expect(await api.moveTransactionRuleFromApi(db, userId, c.id, { direction: "up" })).toEqual({ ok: true, position: 2 });
    expect(await api.moveTransactionRuleFromApi(db, userId, a.id, { direction: "up" })).toEqual({ ok: true, position: 1 });
    expect(await api.moveTransactionRuleFromApi(db, userId, a.id, { direction: "sideways" })).toMatchObject({ ok: false, status: 400 });
    const order = async () => (await api.loadAppRules(db, { id: userId, countryCode: "CA" })).rules.map((r) => r.texts[0]);
    expect(await order()).toEqual(["a", "c", "b"]);

    const kept = await entry(coffee, "c", "07");
    expect(await api.deleteTransactionRuleFromApi(db, userId, c.id)).toEqual({ ok: true });
    expect(await order()).toEqual(["a", "b"]);
    expect(await db.transaction.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ categoryId: coffee });
    expect(await api.loadAppRule(db, { id: userId, countryCode: "CA" }, b.id, true)).toMatchObject({ rule: { position: 2 }, count: 2, matches: 0 });
  });
});
