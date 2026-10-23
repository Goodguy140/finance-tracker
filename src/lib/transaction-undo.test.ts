import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { deleteTransactionWithUndo, undoDeletedTransaction, UNDO_WINDOW_MS } from "./transaction-undo";

const dir = mkdtempSync(join(tmpdir(), "undo-"));
const url = `file:${join(dir, "undo.db")}`;
let db: PrismaClient;

beforeAll(() => {
  copyMigratedDatabase(url);
  db = new PrismaClient({ datasourceUrl: url });
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let foodId: string;
let funId: string;
let accountId: string;
let savingsId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `u${seq}@example.test`, displayName: "Test" } })).id;
  foodId = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
  funId = (await db.category.create({ data: { userId, name: "Fun", kind: "EXPENSE" } })).id;
  accountId = (await db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD" } })).id;
  savingsId = (await db.account.create({ data: { userId, name: "TFSA", type: "TFSA" } })).id;
});

async function richExpense() {
  const tag = await db.tag.create({ data: { userId, name: "Trip", nameKey: "trip" } });
  return db.transaction.create({
    data: {
      userId,
      accountId,
      categoryId: foodId,
      type: "EXPENSE",
      amountCents: 6_000,
      date: new Date("2026-09-10T00:00:00Z"),
      postedDate: new Date("2026-09-11T00:00:00Z"),
      title: "Dinner",
      note: "With Sam",
      splitParts: {
        create: [
          { userId, categoryId: foodId, amountCents: 4_000 },
          { userId, categoryId: funId, amountCents: 2_000 },
        ],
      },
      owedShares: { create: [{ userId, name: "Sam", amountCents: 3_000 }] },
      tags: { create: [{ tagId: tag.id }] },
      verification: {
        create: { userId, source: "MATCHED", plaidTransactionId: "plaid-1", institutionName: "Bank" },
      },
    },
  });
}

describe("deleting with undo", () => {
  it("deletes the entry and puts it back exactly, with the same id", async () => {
    const tx = await richExpense();
    const undoId = await deleteTransactionWithUndo(db, userId, tx.id, "EXPENSE");
    expect(undoId).toBeTruthy();
    expect(await db.transaction.count({ where: { id: tx.id } })).toBe(0);
    expect(await db.owedShare.count({ where: { transactionId: tx.id } })).toBe(0);

    const result = await undoDeletedTransaction(db, userId, undoId!);
    expect(result).toEqual({ ok: true, transactionId: tx.id, type: "EXPENSE" });
    const back = await db.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: { splitParts: true, owedShares: true, tags: true, verification: true },
    });
    expect(back).toMatchObject({ amountCents: 6_000, title: "Dinner", note: "With Sam", accountId, categoryId: foodId });
    expect(back.postedDate?.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(back.splitParts.map((p) => p.amountCents).sort()).toEqual([2_000, 4_000]);
    expect(back.owedShares).toMatchObject([{ name: "Sam", amountCents: 3_000 }]);
    expect(back.tags).toHaveLength(1);
    expect(back.verification).toMatchObject({ plaidTransactionId: "plaid-1", institutionName: "Bank" });
    // Used up: a second Undo has nothing to put back.
    expect(await undoDeletedTransaction(db, userId, undoId!)).toEqual({ ok: false, reason: "expired" });
  });

  it("only deletes the user's own entry of the right type", async () => {
    const tx = await richExpense();
    expect(await deleteTransactionWithUndo(db, userId, tx.id, "INCOME")).toBeNull();
    const other = (await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } })).id;
    expect(await deleteTransactionWithUndo(db, other, tx.id, "EXPENSE")).toBeNull();
    expect(await db.transaction.count({ where: { id: tx.id } })).toBe(1);
  });

  it("will not undo another user's delete", async () => {
    const tx = await richExpense();
    const undoId = await deleteTransactionWithUndo(db, userId, tx.id, "EXPENSE");
    const other = (await db.user.create({ data: { email: `thief${seq}@example.test`, displayName: "Other" } })).id;
    expect(await undoDeletedTransaction(db, other, undoId!)).toEqual({ ok: false, reason: "expired" });
    expect(await db.transaction.count({ where: { id: tx.id } })).toBe(0);
  });

  it("expires after the undo window", async () => {
    const tx = await richExpense();
    const deletedAt = new Date("2026-10-01T12:00:00Z");
    const undoId = await deleteTransactionWithUndo(db, userId, tx.id, "EXPENSE", deletedAt);
    const later = new Date(deletedAt.getTime() + UNDO_WINDOW_MS + 1);
    expect(await undoDeletedTransaction(db, userId, undoId!, later)).toEqual({ ok: false, reason: "expired" });
  });

  it("leaves a bank record that was matched to another entry since with that entry", async () => {
    const tx = await richExpense();
    const undoId = await deleteTransactionWithUndo(db, userId, tx.id, "EXPENSE");
    const replacement = await db.transaction.create({
      data: { userId, accountId, categoryId: foodId, type: "EXPENSE", amountCents: 6_000, date: new Date("2026-09-10T00:00:00Z") },
    });
    await db.transactionVerification.create({
      data: { userId, transactionId: replacement.id, source: "MATCHED", plaidTransactionId: "plaid-1" },
    });
    expect((await undoDeletedTransaction(db, userId, undoId!)).ok).toBe(true);
    expect(await db.transactionVerification.findFirst({ where: { transactionId: tx.id } })).toBeNull();
    expect(await db.transactionVerification.count({ where: { transactionId: replacement.id } })).toBe(1);
  });

  it("re-pairs a transfer and re-links the contribution it was counted as", async () => {
    const out = await db.transaction.create({
      data: { userId, accountId, categoryId: foodId, type: "TRANSFER", amountCents: 500, transferAccountId: savingsId, date: new Date("2026-09-10T00:00:00Z") },
    });
    const into = await db.transaction.create({
      data: { userId, accountId: savingsId, categoryId: foodId, type: "TRANSFER", amountCents: -500, date: new Date("2026-09-10T00:00:00Z") },
    });
    await db.transaction.update({ where: { id: out.id }, data: { transferPeerId: into.id } });
    await db.transaction.update({ where: { id: into.id }, data: { transferPeerId: out.id } });
    const flow = await db.investmentFlow.create({
      data: { userId, accountId: savingsId, date: new Date("2026-09-10T00:00:00Z"), direction: "CONTRIBUTION", amountCents: 500, transactionId: out.id },
    });

    const undoId = await deleteTransactionWithUndo(db, userId, out.id, "TRANSFER");
    expect((await db.transaction.findUniqueOrThrow({ where: { id: into.id } })).transferPeerId).toBeNull();
    expect((await db.investmentFlow.findUniqueOrThrow({ where: { id: flow.id } })).transactionId).toBeNull();

    expect((await undoDeletedTransaction(db, userId, undoId!)).ok).toBe(true);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: into.id } })).transferPeerId).toBe(out.id);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: out.id } })).transferPeerId).toBe(into.id);
    expect((await db.investmentFlow.findUniqueOrThrow({ where: { id: flow.id } })).transactionId).toBe(out.id);
  });

  it("refuses when the category has been deleted since", async () => {
    const tx = await db.transaction.create({
      data: { userId, accountId, categoryId: funId, type: "EXPENSE", amountCents: 100, date: new Date("2026-09-10T00:00:00Z") },
    });
    const undoId = await deleteTransactionWithUndo(db, userId, tx.id, "EXPENSE");
    await db.category.delete({ where: { id: funId } });
    expect(await undoDeletedTransaction(db, userId, undoId!)).toEqual({ ok: false, reason: "category-gone" });
  });

  it("prunes kept deletes older than the window", async () => {
    const a = await richExpense();
    const old = new Date("2026-01-01T00:00:00Z");
    await deleteTransactionWithUndo(db, userId, a.id, "EXPENSE", old);
    const b = await db.transaction.create({
      data: { userId, categoryId: foodId, type: "EXPENSE", amountCents: 1, date: old },
    });
    await deleteTransactionWithUndo(db, userId, b.id, "EXPENSE", new Date("2026-01-02T00:00:00Z"));
    expect(await db.deletedTransaction.count({ where: { userId } })).toBe(1);
  });
});
