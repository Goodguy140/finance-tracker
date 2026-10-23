import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OWED_SHARES_FIELD } from "@/lib/owed-shares";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * Reimbursements end to end against a real SQLite database built from the migrations: the
 * edit dialog's save, the "Owed to you" paid toggle, and the places that compare an expense
 * with the bank, which must see what was paid rather than the user's own part.
 */

const dir = mkdtempSync(join(tmpdir(), "owed-shares-"));
const url = `file:${join(dir, "owed.db")}`;
let db: PrismaClient;
let actions: typeof import("./transactions");
let owedActions: typeof import("./owed-shares");
let createSyncStore: typeof import("@/lib/plaid/sync-store").createSyncStore;
let markAsTransfer: typeof import("@/lib/transfer-marking").markAsTransfer;

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: session.userId })) }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));

beforeAll(async () => {
  copyMigratedDatabase(url);
  // The actions use the app's shared client, which reads DATABASE_URL when first loaded.
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./transactions");
  owedActions = await import("./owed-shares");
  ({ createSyncStore } = await import("@/lib/plaid/sync-store"));
  ({ markAsTransfer } = await import("@/lib/transfer-marking"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let foodId: string;
let accountId: string;

beforeEach(async () => {
  seq += 1;
  session.userId = (await db.user.create({ data: { email: `o${seq}@example.test`, displayName: "Test" } })).id;
  foodId = (await db.category.create({ data: { userId: session.userId, name: "Food", kind: "EXPENSE" } })).id;
  accountId = (await db.account.create({ data: { userId: session.userId, name: "Visa", type: "CREDIT_CARD" } })).id;
});

function expense(amountCents: number) {
  return db.transaction.create({
    data: {
      userId: session.userId,
      accountId,
      categoryId: foodId,
      type: "EXPENSE",
      amountCents,
      date: new Date("2026-09-10T00:00:00Z"),
      title: "Dinner",
    },
  });
}

/** The edit dialog's form: `amount` is what the user paid; `owed` rows are [id, name, amount]. */
function editForm(transactionId: string, amount: string, owed: Array<[string, string, string]> | null) {
  const data = new FormData();
  data.set("transactionId", transactionId);
  data.set("accountId", accountId);
  data.set("categoryId", foodId);
  data.set("date", "2026-09-10");
  data.set("title", "Dinner");
  data.set("note", "");
  data.set("amount", amount);
  data.set("preCreditTotal", "");
  if (owed) {
    data.set(OWED_SHARES_FIELD, "1");
    for (const [id, name, value] of owed) {
      data.append("owedShareId", id);
      data.append("owedName", name);
      data.append("owedAmount", value);
    }
  }
  return data;
}

const shares = (transactionId: string) =>
  db.owedShare.findMany({ where: { transactionId }, orderBy: { createdAt: "asc" } });
const amountOf = async (id: string) => (await db.transaction.findUniqueOrThrow({ where: { id } })).amountCents;

describe("updateExpenseAction with owed shares", () => {
  it("takes what others owe out of the expense, so totals count only the user's part", async () => {
    const dinner = await expense(12000);
    expect(
      await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"], ["", "Alex", "30.50"]])),
    ).toBeUndefined();

    expect(await amountOf(dinner.id)).toBe(4950);
    expect((await shares(dinner.id)).map((s) => [s.name, s.amountCents, s.paidAt])).toEqual([
      ["Sam", 4000, null],
      ["Alex", 3050, null],
    ]);
  });

  it("keeps the shares (and whether they were paid) when only the amount changes", async () => {
    const dinner = await expense(12000);
    await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"]]));
    const [sam] = await shares(dinner.id);
    await owedActions.setOwedSharePaidAction(paidForm(sam.id, "true"));

    await actions.updateExpenseAction(editForm(dinner.id, "130", [[sam.id, "Sam", "40"]]));
    expect(await amountOf(dinner.id)).toBe(9000);
    const [after] = await shares(dinner.id);
    expect(after.id).toBe(sam.id);
    expect(after.paidAt).not.toBeNull();
  });

  it("leaves the shares alone when the form does not carry them", async () => {
    const dinner = await expense(12000);
    await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"]]));
    await actions.updateExpenseAction(editForm(dinner.id, "100", null));
    expect(await amountOf(dinner.id)).toBe(6000);
    expect(await shares(dinner.id)).toHaveLength(1);
  });

  it("puts a removed share back into the user's spending", async () => {
    const dinner = await expense(12000);
    await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"]]));
    await actions.updateExpenseAction(editForm(dinner.id, "120", []));
    expect(await amountOf(dinner.id)).toBe(12000);
    expect(await shares(dinner.id)).toHaveLength(0);
  });

  it("allows a bill owed in full, and refuses more than was paid or shares on a refund", async () => {
    const bill = await expense(5000);
    expect(await actions.updateExpenseAction(editForm(bill.id, "50", [["", "Sam", "50"]]))).toBeUndefined();
    expect(await amountOf(bill.id)).toBe(0);

    expect(await actions.updateExpenseAction(editForm(bill.id, "50", [["", "Sam", "50.01"]]))).toEqual({
      ok: false,
      error: "What others owe adds up to more than you paid.",
    });
    expect(await actions.updateExpenseAction(editForm(bill.id, "-50", [["", "Sam", "10"]]))).toMatchObject({ ok: false });
    // Nothing from the refused saves stuck.
    expect(await amountOf(bill.id)).toBe(0);
    expect((await shares(bill.id)).map((s) => s.amountCents)).toEqual([5000]);
  });

  it("refuses a share id from another expense", async () => {
    const mine = await expense(4000);
    const other = await expense(6000);
    await actions.updateExpenseAction(editForm(other.id, "60", [["", "Sam", "10"]]));
    const [foreign] = await shares(other.id);

    expect(await actions.updateExpenseAction(editForm(mine.id, "40", [[foreign.id, "Sam", "10"]]))).toMatchObject({
      ok: false,
    });
    expect(await amountOf(mine.id)).toBe(4000);
    expect(await shares(other.id)).toHaveLength(1);
  });

  it("refuses shares on a bill whose subscription already splits it", async () => {
    const rule = await db.recurringTransaction.create({
      data: {
        userId: session.userId,
        accountId,
        categoryId: foodId,
        type: "EXPENSE",
        name: "Streaming",
        amountCents: 2000,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-10-10T00:00:00Z"),
        subscriptionMembers: { create: { userId: session.userId, name: "Sam", shareCents: 1000 } },
      },
    });
    const posted = await db.transaction.update({
      where: { id: (await expense(2000)).id },
      data: { recurringTransactionId: rule.id, recurringExpectedDate: new Date("2026-09-10T00:00:00Z") },
    });

    expect(await actions.updateExpenseAction(editForm(posted.id, "20", [["", "Sam", "10"]]))).toMatchObject({
      ok: false,
    });
    expect(await amountOf(posted.id)).toBe(2000);
  });
});

function paidForm(shareId: string, paid: "true" | "false") {
  const data = new FormData();
  data.set("shareId", shareId);
  data.set("paid", paid);
  return data;
}

describe("setOwedSharePaidAction", () => {
  it("records the repayment without changing any total, and can be undone", async () => {
    const dinner = await expense(12000);
    await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"]]));
    const [sam] = await shares(dinner.id);

    await owedActions.setOwedSharePaidAction(paidForm(sam.id, "true"));
    expect((await shares(dinner.id))[0].paidAt).not.toBeNull();
    expect(await amountOf(dinner.id)).toBe(8000);

    await owedActions.setOwedSharePaidAction(paidForm(sam.id, "false"));
    expect((await shares(dinner.id))[0].paidAt).toBeNull();
  });

  it("refuses another user's share", async () => {
    const dinner = await expense(12000);
    await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"]]));
    const [sam] = await shares(dinner.id);

    session.userId = (await db.user.create({ data: { email: `intruder${seq}@example.test`, displayName: "X" } })).id;
    expect(await owedActions.setOwedSharePaidAction(paidForm(sam.id, "true"))).toMatchObject({ ok: false });
    expect((await db.owedShare.findUniqueOrThrow({ where: { id: sam.id } })).paidAt).toBeNull();
  });
});

describe("comparing a shared expense with the bank", () => {
  it("reports what was paid, not the user's part, as the approved amount", async () => {
    const dinner = await expense(12000);
    await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"]]));

    const approved = await createSyncStore().loadApprovedAmounts(session.userId, [dinner.id]);
    expect(approved.get(dinner.id)).toBe(12000);
  });

  it("will not turn a shared expense into a transfer", async () => {
    const dinner = await expense(12000);
    await actions.updateExpenseAction(editForm(dinner.id, "120", [["", "Sam", "40"]]));
    expect(await db.$transaction((tx) => markAsTransfer(tx, { userId: session.userId, transactionId: dinner.id }))).toEqual({
      ok: false,
      reason: "owed",
    });
  });
});
