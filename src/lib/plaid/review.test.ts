import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addStagedRow,
  COMMITTABLE_STAGED_SELECT,
  ignoreStagedRow,
  linkStagedRow,
  toCommittable,
  type CommittableStagedRow,
} from "@/lib/plaid/review";

/**
 * Against a real SQLite database built from the migrations, because the property that
 * matters — a row can be committed once — lives in conditional updates and a unique key,
 * which a mocked Prisma would only echo back.
 */

const dir = mkdtempSync(join(tmpdir(), "plaid-review-"));
const url = `file:${join(dir, "review.db")}`;
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
let categoryId: string;
let staged: CommittableStagedRow;
let seq = 0;

async function stage(overrides: { amountCents?: number; type?: "EXPENSE" | "INCOME"; postedDate?: Date | null } = {}) {
  seq += 1;
  const item = await db.plaidItem.findFirstOrThrow({ where: { userId } });
  const account = await db.plaidAccount.findFirstOrThrow({ where: { userId } });
  const row = await db.plaidStagedTransaction.create({
    data: {
      userId,
      plaidItemId: item.id,
      plaidAccountRowId: account.id,
      plaidTransactionId: `ptx-${seq}`,
      name: "BLUE BOTTLE",
      amountCents: overrides.amountCents ?? 1200,
      type: overrides.type ?? "EXPENSE",
      date: new Date("2026-09-10T00:00:00Z"),
      postedDate: overrides.postedDate === undefined ? new Date("2026-09-11T00:00:00Z") : overrides.postedDate,
    },
    select: COMMITTABLE_STAGED_SELECT,
  });
  return toCommittable(row);
}

async function entered(overrides: { type?: "EXPENSE" | "INCOME"; postedDate?: Date | null } = {}) {
  return db.transaction.create({
    data: {
      userId,
      categoryId,
      type: overrides.type ?? "EXPENSE",
      amountCents: 1200,
      date: new Date("2026-09-10T00:00:00Z"),
      postedDate: overrides.postedDate ?? null,
      title: "Coffee",
    },
  });
}

const proposal = { title: "Blue Bottle", note: null };

beforeEach(async () => {
  seq += 1;
  const user = await db.user.create({ data: { email: `u${seq}@example.test`, displayName: "Test" } });
  userId = user.id;
  categoryId = (await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } })).id;
  const item = await db.plaidItem.create({
    data: {
      userId,
      itemId: `item-${seq}`,
      accessTokenEnc: "x",
      requestedDays: 90,
      historyCutoff: new Date("2026-06-01T00:00:00Z"),
      institutionName: "Test Credit Union",
    },
  });
  await db.plaidAccount.create({
    data: { userId, plaidItemId: item.id, plaidAccountId: `acct-${seq}`, name: "Chequing", plaidType: "depository" },
  });
  staged = await stage();
});

describe("addStagedRow", () => {
  it("adds the row once, however many times it is submitted", async () => {
    const first = await db.$transaction((tx) => addStagedRow(tx, { userId, staged, categoryId, proposal }));
    // The second submit read the row before the first committed; it must still lose.
    const second = await db.$transaction((tx) => addStagedRow(tx, { userId, staged, categoryId, proposal }));

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "already-reviewed" });
    expect(await db.transaction.count({ where: { userId } })).toBe(1);
    const row = await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: staged.id } });
    expect(row.status).toBe("ADDED");
    expect(row.resolvedTransactionId).toBe(first.ok ? first.transactionId : null);
    const verification = await db.transactionVerification.findFirstOrThrow({ where: { userId } });
    expect(verification).toMatchObject({ source: "IMPORTED", institutionName: "Test Credit Union" });
  });

  it("adds the row once when two submits race", async () => {
    const outcomes = await Promise.all([
      db.$transaction((tx) => addStagedRow(tx, { userId, staged, categoryId, proposal })),
      db.$transaction((tx) => addStagedRow(tx, { userId, staged, categoryId, proposal })),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(await db.transaction.count({ where: { userId } })).toBe(1);
  });

  it("refuses a row that was ignored", async () => {
    expect(await ignoreStagedRow(db, { userId, stagedId: staged.id })).toBe(true);
    const outcome = await db.$transaction((tx) => addStagedRow(tx, { userId, staged, categoryId, proposal }));
    expect(outcome).toEqual({ ok: false, reason: "already-reviewed" });
    expect(await db.transaction.count({ where: { userId } })).toBe(0);
  });
});

describe("linkStagedRow", () => {
  it("verifies the user's entry and fills in the bank's posted date only when missing", async () => {
    const target = await entered();
    const outcome = await db.$transaction((tx) => linkStagedRow(tx, { userId, staged, transactionId: target.id }));

    expect(outcome).toEqual({ ok: true, transactionId: target.id });
    const after = await db.transaction.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.postedDate).toEqual(new Date("2026-09-11T00:00:00Z"));
    expect(after.amountCents).toBe(1200);
    expect(after.title).toBe("Coffee");
    const row = await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: staged.id } });
    expect(row).toMatchObject({ status: "LINKED", resolvedTransactionId: target.id });

    const dated = await entered({ postedDate: new Date("2026-09-15T00:00:00Z") });
    const other = await stage();
    await db.$transaction((tx) => linkStagedRow(tx, { userId, staged: other, transactionId: dated.id }));
    expect((await db.transaction.findUniqueOrThrow({ where: { id: dated.id } })).postedDate).toEqual(
      new Date("2026-09-15T00:00:00Z"),
    );
  });

  it("refuses a transaction already confirmed against another bank row", async () => {
    const target = await entered();
    await db.$transaction((tx) => linkStagedRow(tx, { userId, staged, transactionId: target.id }));
    const other = await stage();
    const outcome = await db.$transaction((tx) => linkStagedRow(tx, { userId, staged: other, transactionId: target.id }));
    expect(outcome).toEqual({ ok: false, reason: "target-verified" });
    expect((await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("NEEDS_REVIEW");
  });

  it("refuses to link an expense row to an income entry", async () => {
    const income = await entered({ type: "INCOME" });
    const outcome = await db.$transaction((tx) => linkStagedRow(tx, { userId, staged, transactionId: income.id }));
    expect(outcome).toEqual({ ok: false, reason: "type-mismatch" });
  });

  it("refuses a row that was already added", async () => {
    await db.$transaction((tx) => addStagedRow(tx, { userId, staged, categoryId, proposal }));
    const target = await entered();
    const outcome = await db.$transaction((tx) => linkStagedRow(tx, { userId, staged, transactionId: target.id }));
    expect(outcome).toEqual({ ok: false, reason: "already-reviewed" });
    expect(await db.transactionVerification.count({ where: { transactionId: target.id } })).toBe(0);
  });

  it("does not reach another user's transaction", async () => {
    const target = await entered();
    const outcome = await db.$transaction((tx) =>
      linkStagedRow(tx, { userId: "someone-else", staged, transactionId: target.id }),
    );
    expect(outcome).toEqual({ ok: false, reason: "target-not-found" });
  });
});
