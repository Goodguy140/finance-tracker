import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { markAsTransfer, setTransferAccount, unmarkTransfer, unpairTransfer } from "@/lib/transfer-marking";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Against a real SQLite database built from the migrations, like the review queue's tests. */

const dir = mkdtempSync(join(tmpdir(), "transfer-marking-"));
const url = `file:${join(dir, "transfers.db")}`;
let db: PrismaClient;

beforeAll(() => {
  copyMigratedDatabase(url);
  db = new PrismaClient({ datasourceUrl: url });
});

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

describe("paired transfers", () => {
  async function pair() {
    const chequing = await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } });
    const visa = await db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD" } });
    const out = await entry("EXPENSE", 40000);
    const arrived = await entry("INCOME", 40000);
    await mark(out.id);
    await mark(arrived.id);
    await db.transaction.update({
      where: { id: out.id },
      data: { accountId: chequing.id, transferAccountId: visa.id, transferPeerId: arrived.id },
    });
    await db.transaction.update({
      where: { id: arrived.id },
      data: { accountId: visa.id, transferAccountId: chequing.id, transferPeerId: out.id },
    });
    return { out, arrived, chequing, visa };
  }

  it("unmarks both legs together and forgets the pair", async () => {
    const { out, arrived } = await pair();
    expect(await unmark(arrived.id)).toEqual({ ok: true, type: "INCOME" });
    const rows = await db.transaction.findMany({ where: { id: { in: [out.id, arrived.id] } }, orderBy: { type: "asc" } });
    expect(rows.map((r) => [r.type, r.amountCents, r.transferAccountId, r.transferPeerId])).toEqual([
      ["EXPENSE", 40000, null, null],
      ["INCOME", 40000, null, null],
    ]);
  });

  it("unpairs into two transfers with no other side", async () => {
    const { out, arrived } = await pair();
    expect(await db.$transaction((tx) => unpairTransfer(tx, { userId, transactionId: out.id }))).toEqual({
      ok: true,
      type: "TRANSFER",
    });
    const rows = await db.transaction.findMany({ where: { id: { in: [out.id, arrived.id] } } });
    expect(rows.every((r) => r.type === "TRANSFER" && r.transferPeerId === null && r.transferAccountId === null)).toBe(true);
  });

  it("deleting one leg leaves the other a transfer with no peer", async () => {
    const { out, arrived } = await pair();
    await db.transaction.delete({ where: { id: out.id } });
    expect(await db.transaction.findUniqueOrThrow({ where: { id: arrived.id } })).toMatchObject({
      type: "TRANSFER",
      transferPeerId: null,
    });
  });
});

describe("setTransferAccount", () => {
  const set = (transactionId: string, transferAccountId: string | null, uid = userId) =>
    db.$transaction((tx) => setTransferAccount(tx, { userId: uid, transactionId, transferAccountId }));

  it("names and clears the other side of an unpaired transfer", async () => {
    const chequing = await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } });
    const savings = await db.account.create({ data: { userId, name: "Savings", type: "SAVINGS" } });
    const move = await entry("EXPENSE", 10000);
    await mark(move.id);
    await db.transaction.update({ where: { id: move.id }, data: { accountId: chequing.id } });

    expect(await set(move.id, savings.id)).toEqual({ ok: true, type: "TRANSFER" });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: move.id } })).transferAccountId).toBe(savings.id);
    expect(await set(move.id, null)).toEqual({ ok: true, type: "TRANSFER" });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: move.id } })).transferAccountId).toBeNull();

    // Its own account, someone else's account, someone else's transfer, and a non-transfer.
    expect(await set(move.id, chequing.id)).toEqual({ ok: false, reason: "same-account" });
    const otherUser = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const theirs = await db.account.create({ data: { userId: otherUser.id, name: "Theirs", type: "SAVINGS" } });
    expect(await set(move.id, theirs.id)).toEqual({ ok: false, reason: "not-found" });
    expect(await set(move.id, savings.id, otherUser.id)).toEqual({ ok: false, reason: "not-found" });
    const expense = await entry("EXPENSE", 900);
    expect(await set(expense.id, savings.id)).toEqual({ ok: false, reason: "not-found" });
  });
});
