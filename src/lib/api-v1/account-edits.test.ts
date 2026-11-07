import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Settings → Accounts' add and edit for the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-account-edits-"));
const url = `file:${join(dir, "accounts.db")}`;
let db: PrismaClient;
let api: typeof import("./account-edits");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./account-edits");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: { id: string; countryCode: string };

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `accounts${seq}@example.test`, displayName: "Test", countryCode: "JP" },
    select: { id: true, countryCode: true },
  });
});

const read = (id: string) =>
  db.account.findUniqueOrThrow({
    where: { id },
    select: { name: true, type: true, currency: true, countsAsSavings: true, archived: true, creditLimitCents: true, paymentDueDay: true },
  });

async function created(body: unknown): Promise<string> {
  const result = await api.createAccountFromApi(db, user, body);
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

describe("adding an account", () => {
  it("adds it in the home currency, counted as savings when its type usually is, and logs it", async () => {
    const savings = await created({ name: "High interest", type: "SAVINGS" });
    expect(await read(savings)).toMatchObject({ name: "High interest", type: "SAVINGS", currency: "JPY", countsAsSavings: true, archived: false });
    expect(await read(await created({ name: "  Visa  ", type: "CREDIT_CARD" }))).toMatchObject({ name: "Visa", countsAsSavings: false });
    expect(await db.auditLog.count({ where: { userId: user.id, action: "financial_account_created" } })).toBe(2);

    expect(await api.createAccountFromApi(db, user, { name: "X", type: "SAVINGS" })).toMatchObject({ ok: false, status: 400 });
    expect(await api.createAccountFromApi(db, user, { name: "Wallet", type: "PIGGY_BANK" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("changing an account", () => {
  it("changes only what the body names, and a card's limit and due day", async () => {
    const card = await created({ name: "Visa", type: "CREDIT_CARD" });
    await db.account.update({ where: { id: card }, data: { paymentRemindedFor: new Date("2026-10-15T00:00:00Z") } });

    expect(await api.patchAccountFromApi(db, user.id, card, { name: "Visa Infinite", creditLimitCents: 500_000, paymentDueDay: 21 })).toEqual({ ok: true, id: card });
    expect(await read(card)).toMatchObject({ name: "Visa Infinite", type: "CREDIT_CARD", currency: "JPY", creditLimitCents: 500_000, paymentDueDay: 21 });
    // A new due day is a new schedule, so its first date gets its reminder.
    expect((await db.account.findUniqueOrThrow({ where: { id: card } })).paymentRemindedFor).toBeNull();

    // The limit alone keeps the due day; null clears it.
    await api.patchAccountFromApi(db, user.id, card, { creditLimitCents: null });
    expect(await read(card)).toMatchObject({ creditLimitCents: null, paymentDueDay: 21 });
    expect(await api.patchAccountFromApi(db, user.id, card, { paymentDueDay: 32 })).toMatchObject({ ok: false, status: 400 });

    const chequing = await created({ name: "Chequing", type: "CHEQUING" });
    expect(await api.patchAccountFromApi(db, user.id, chequing, { countsAsSavings: true, currency: "cad" })).toEqual({ ok: true, id: chequing });
    expect(await read(chequing)).toMatchObject({ countsAsSavings: true, currency: "CAD" });
    expect(await api.patchAccountFromApi(db, user.id, chequing, { creditLimitCents: 100_000 })).toEqual({
      ok: false,
      status: 400,
      error: "Only credit cards have a limit and due day.",
    });
  });

  it("keeps the currency of an account that already holds money in it", async () => {
    const chequing = await created({ name: "Chequing", type: "CHEQUING" });
    const category = await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } });
    await db.transaction.create({ data: { userId: user.id, accountId: chequing, categoryId: category.id, type: "EXPENSE", amountCents: 1_000, date: new Date() } });
    expect(await api.patchAccountFromApi(db, user.id, chequing, { currency: "EUR" })).toMatchObject({ ok: false, status: 400 });
    expect(await read(chequing)).toMatchObject({ currency: "JPY" });
  });

  it("archives and restores it, refusing while a recurring rule uses it, and drops it as the expense default", async () => {
    const chequing = await created({ name: "Chequing", type: "CHEQUING" });
    await db.user.update({ where: { id: user.id }, data: { defaultExpenseAccountId: chequing } });
    expect(await api.patchAccountFromApi(db, user.id, chequing, { archived: true })).toEqual({ ok: true, id: chequing });
    expect(await read(chequing)).toMatchObject({ archived: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).defaultExpenseAccountId).toBeNull();
    expect(await api.patchAccountFromApi(db, user.id, chequing, { archived: false })).toEqual({ ok: true, id: chequing });
    expect(await read(chequing)).toMatchObject({ archived: false });
    expect(await db.auditLog.count({ where: { targetId: chequing, action: { in: ["financial_account_archived", "financial_account_unarchived"] } } })).toBe(2);

    const category = await db.category.create({ data: { userId: user.id, name: "Rent", kind: "EXPENSE" } });
    await db.recurringTransaction.create({
      data: { userId: user.id, accountId: chequing, categoryId: category.id, name: "Rent", type: "EXPENSE", amountCents: 100_000, cadence: "MONTHLY", nextExpectedDate: new Date() },
    });
    expect(await api.patchAccountFromApi(db, user.id, chequing, { archived: true })).toMatchObject({ ok: false, status: 400 });
    expect(await read(chequing)).toMatchObject({ archived: false });
  });

  it("refuses another person's account, and fields the form does not have", async () => {
    const other = await db.user.create({ data: { email: `accountsother${seq}@example.test`, displayName: "Other" } });
    const theirs = (await db.account.create({ data: { userId: other.id, name: "Theirs", type: "CHEQUING" } })).id;
    expect(await api.patchAccountFromApi(db, user.id, theirs, { name: "Mine now" })).toEqual({ ok: false, status: 404, error: "Account not found." });
    expect(await read(theirs)).toMatchObject({ name: "Theirs" });
    const mine = await created({ name: "Chequing", type: "CHEQUING" });
    expect(await api.patchAccountFromApi(db, user.id, mine, { userId: other.id })).toMatchObject({ ok: false, status: 400 });
  });
});
