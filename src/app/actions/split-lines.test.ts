import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OWED_SHARES_FIELD } from "@/lib/owed-shares";
import { SPLIT_LINES_FIELD } from "@/lib/split-lines";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * Editing an existing split expense through the edit dialog's save, against a real SQLite
 * database built from the migrations. New splits cannot be created, so a plain expense
 * must refuse lines.
 */

const dir = mkdtempSync(join(tmpdir(), "split-lines-"));
const url = `file:${join(dir, "split.db")}`;
let db: PrismaClient;
let actions: typeof import("./transactions");

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.userId })) }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./transactions");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let foodId: string;
let gasId: string;
let homeId: string;
let accountId: string;

beforeEach(async () => {
  seq += 1;
  session.userId = (await db.user.create({ data: { email: `s${seq}@example.test`, displayName: "Test" } })).id;
  const category = (name: string) =>
    db.category.create({ data: { userId: session.userId, name, kind: "EXPENSE" } }).then((c) => c.id);
  foodId = await category("Food");
  gasId = await category("Gas");
  homeId = await category("Home");
  accountId = (await db.account.create({ data: { userId: session.userId, name: "Visa", type: "CREDIT_CARD" } })).id;
});

/** A split as the retired split form saved it: the parent in an arbitrary category, the parts summing to it. */
function splitExpense(parts: Array<[string, number]>) {
  return db.transaction.create({
    data: {
      userId: session.userId,
      accountId,
      categoryId: homeId,
      type: "EXPENSE",
      amountCents: parts.reduce((sum, [, cents]) => sum + cents, 0),
      date: new Date("2026-09-10T00:00:00Z"),
      title: "Costco",
      splitParts: {
        create: parts.map(([categoryId, amountCents]) => ({ userId: session.userId, categoryId, amountCents })),
      },
    },
  });
}

/** The edit dialog's form for a split: `lines` are [categoryId, amount]; null leaves them out. */
function editForm(transactionId: string, amount: string, lines: Array<[string, string]> | null, title = "Costco") {
  const data = new FormData();
  data.set("transactionId", transactionId);
  data.set("accountId", accountId);
  data.set("categoryId", homeId);
  data.set("date", "2026-09-10");
  data.set("title", title);
  data.set("note", "");
  data.set("amount", amount);
  data.set("preCreditTotal", "");
  data.set(OWED_SHARES_FIELD, "1");
  if (lines) {
    data.set(SPLIT_LINES_FIELD, "1");
    for (const [categoryId, value] of lines) {
      data.append("splitCategoryId", categoryId);
      data.append("splitAmount", value);
    }
  }
  return data;
}

const partsOf = async (transactionId: string) =>
  (await db.splitTransactionPart.findMany({ where: { transactionId }, orderBy: { id: "asc" } })).map((p) => [
    p.categoryId,
    p.amountCents,
  ]);
const txnOf = (id: string) => db.transaction.findUniqueOrThrow({ where: { id } });

describe("updateExpenseAction on a split expense", () => {
  it("replaces the lines and the amount when they add up", async () => {
    const costco = await splitExpense([[foodId, 6000], [gasId, 4000]]);
    expect(
      await actions.updateExpenseAction(editForm(costco.id, "125.50", [[foodId, "70"], [gasId, "40.25"], [homeId, "15.25"]], "Costco run")),
    ).toBeUndefined();

    expect(await partsOf(costco.id)).toEqual([
      [foodId, 7000],
      [gasId, 4025],
      [homeId, 1525],
    ]);
    const saved = await txnOf(costco.id);
    expect(saved.amountCents).toBe(12550);
    expect(saved.title).toBe("Costco run");
    expect(saved.categoryId).toBe(foodId);
  });

  it("refuses lines that do not add up to the amount, and changes nothing", async () => {
    const costco = await splitExpense([[foodId, 6000], [gasId, 4000]]);
    expect(await actions.updateExpenseAction(editForm(costco.id, "100", [[foodId, "60"], [gasId, "39.99"]]))).toEqual({
      ok: false,
      error: "The split lines add up to 99.99, but the expense is 100.00. Make them match.",
    });
    expect(await partsOf(costco.id)).toEqual([
      [foodId, 6000],
      [gasId, 4000],
    ]);
  });

  it("becomes a regular expense in the last line's category when one line is left", async () => {
    const costco = await splitExpense([[foodId, 6000], [gasId, 4000]]);
    expect(await actions.updateExpenseAction(editForm(costco.id, "100", [[gasId, "100"]]))).toBeUndefined();

    expect(await partsOf(costco.id)).toEqual([]);
    const saved = await txnOf(costco.id);
    expect(saved.categoryId).toBe(gasId);
    expect(saved.amountCents).toBe(10000);
  });

  it("refuses a save without the lines, so a stale form cannot drop them", async () => {
    const costco = await splitExpense([[foodId, 6000], [gasId, 4000]]);
    expect(await actions.updateExpenseAction(editForm(costco.id, "100", null))).toMatchObject({ ok: false });
    expect(await partsOf(costco.id)).toHaveLength(2);
  });

  it("refuses owed shares on a split", async () => {
    const costco = await splitExpense([[foodId, 6000], [gasId, 4000]]);
    const form = editForm(costco.id, "100", [[foodId, "60"], [gasId, "40"]]);
    form.append("owedShareId", "");
    form.append("owedName", "Sam");
    form.append("owedAmount", "10");
    expect(await actions.updateExpenseAction(form)).toMatchObject({ ok: false });
    expect((await txnOf(costco.id)).amountCents).toBe(10000);
  });

  it("refuses a category the user does not own", async () => {
    const costco = await splitExpense([[foodId, 6000], [gasId, 4000]]);
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const foreign = await db.category.create({ data: { userId: other.id, name: "Food", kind: "EXPENSE" } });
    expect(await actions.updateExpenseAction(editForm(costco.id, "100", [[foreign.id, "60"], [gasId, "40"]]))).toMatchObject({
      ok: false,
    });
    expect(await partsOf(costco.id)).toEqual([
      [foodId, 6000],
      [gasId, 4000],
    ]);
  });

  it("does not turn a plain expense into a split", async () => {
    const plain = await db.transaction.create({
      data: { userId: session.userId, accountId, categoryId: foodId, type: "EXPENSE", amountCents: 10000, date: new Date("2026-09-10T00:00:00Z") },
    });
    expect(await actions.updateExpenseAction(editForm(plain.id, "100", [[foodId, "60"], [gasId, "40"]]))).toMatchObject({
      ok: false,
    });
    expect(await partsOf(plain.id)).toEqual([]);
  });
});
