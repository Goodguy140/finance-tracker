import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { markAsTransfer, unmarkTransfer } from "@/lib/transfer-marking";

/** Against a real SQLite database built from the migrations, like the review queue's tests. */

const dir = mkdtempSync(join(tmpdir(), "transfer-marking-"));
const url = `file:${join(dir, "transfers.db")}`;
let db: PrismaClient;

beforeAll(() => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  db = new PrismaClient({ datasourceUrl: url });
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let userId: string;
let foodId: string;
let salaryId: string;
let seq = 0;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `t${seq}@example.test`, displayName: "Test" } })).id;
  foodId = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
  salaryId = (await db.category.create({ data: { userId, name: "Salary", kind: "INCOME" } })).id;
});

function entry(type: "EXPENSE" | "INCOME", amountCents: number) {
  return db.transaction.create({
    data: {
      userId,
      categoryId: type === "EXPENSE" ? foodId : salaryId,
      type,
      amountCents,
      date: new Date("2026-09-10T00:00:00Z"),
      title: "Visa payment",
    },
  });
}

const mark = (transactionId: string, uid = userId) =>
  db.$transaction((tx) => markAsTransfer(tx, { userId: uid, transactionId }));
const unmark = (transactionId: string) => db.$transaction((tx) => unmarkTransfer(tx, { userId, transactionId }));

describe("markAsTransfer", () => {
  it("moves an expense into one Transfers category, keeping the money and the title", async () => {
    const a = await entry("EXPENSE", 40000);
    const b = await entry("EXPENSE", 1500);
    expect(await mark(a.id)).toEqual({ ok: true, type: "TRANSFER" });
    expect(await mark(b.id)).toEqual({ ok: true, type: "TRANSFER" });

    const rows = await db.transaction.findMany({ where: { userId }, include: { category: true }, orderBy: { amountCents: "desc" } });
    expect(rows.map((r) => [r.type, r.amountCents, r.title, r.category.name, r.category.kind])).toEqual([
      ["TRANSFER", 40000, "Visa payment", "Transfers", "TRANSFER"],
      ["TRANSFER", 1500, "Visa payment", "Transfers", "TRANSFER"],
    ]);
    expect(await db.category.count({ where: { userId, kind: "TRANSFER" } })).toBe(1);
  });

  it("books income as money arriving", async () => {
    const deposit = await entry("INCOME", 25000);
    await mark(deposit.id);
    expect(await db.transaction.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({
      type: "TRANSFER",
      amountCents: -25000,
    });
  });

  it("refuses a split expense and another user's entry", async () => {
    const split = await entry("EXPENSE", 2000);
    await db.splitTransactionPart.create({
      data: { userId, transactionId: split.id, categoryId: foodId, amountCents: 2000 },
    });
    expect(await mark(split.id)).toEqual({ ok: false, reason: "split" });

    const mine = await entry("EXPENSE", 2000);
    expect(await mark(mine.id, "someone-else")).toEqual({ ok: false, reason: "not-found" });
    expect(await db.transaction.count({ where: { userId, type: "TRANSFER" } })).toBe(0);
  });
});

describe("unmarkTransfer", () => {
  it("returns money out as an expense and money in as income, in the catch-all", async () => {
    const out = await entry("EXPENSE", 40000);
    const arrived = await entry("INCOME", 25000);
    await mark(out.id);
    await mark(arrived.id);

    expect(await unmark(out.id)).toEqual({ ok: true, type: "EXPENSE" });
    expect(await unmark(arrived.id)).toEqual({ ok: true, type: "INCOME" });

    const back = await db.transaction.findMany({ where: { userId }, include: { category: true }, orderBy: { amountCents: "desc" } });
    expect(back.map((r) => [r.type, r.amountCents, r.category.name, r.category.kind])).toEqual([
      ["EXPENSE", 40000, "Other", "EXPENSE"],
      ["INCOME", 25000, "Other", "INCOME"],
    ]);
  });

  it("leaves an entry that is not a transfer alone", async () => {
    const expense = await entry("EXPENSE", 900);
    expect(await unmark(expense.id)).toEqual({ ok: false, reason: "not-found" });
  });
});
