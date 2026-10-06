import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addStagedRow,
  applyBankRevision,
  COMMITTABLE_STAGED_SELECT,
  ignoreStagedRow,
  linkStagedRow,
  pairStagedRows,
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

async function stage(
  overrides: { amountCents?: number; type?: "EXPENSE" | "INCOME" | "TRANSFER"; postedDate?: Date | null } = {},
) {
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

  it("books income the user called a transfer with the transfer's sign, and keeps it on revision", async () => {
    const deposit = await stage({ type: "INCOME", amountCents: 50000 });
    const transferCategoryId = (await db.category.create({ data: { userId, name: "Transfers", kind: "TRANSFER" } })).id;
    const outcome = await db.$transaction((tx) =>
      addStagedRow(tx, { userId, staged: deposit, categoryId: transferCategoryId, proposal, type: "TRANSFER" }),
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    const committed = await db.transaction.findUniqueOrThrow({ where: { id: outcome.transactionId } });
    // $500 arrived: -50000 as a transfer, not +50000, which would read as $500 leaving.
    expect(committed).toMatchObject({ type: "TRANSFER", amountCents: -50000, categoryId: transferCategoryId });
    // The staged row keeps the bank's own view.
    expect(await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({
      type: "INCOME",
      amountCents: 50000,
    });

    // The bank revises the deposit to $520; taking its values keeps the transfer's sign.
    await db.plaidStagedTransaction.update({
      where: { id: deposit.id },
      data: { amountCents: 52000, revisedAfterResolveAt: new Date() },
    });
    expect(await db.$transaction((tx) => applyBankRevision(tx, { userId, stagedId: deposit.id }))).toBe(true);
    expect(await db.transaction.findUniqueOrThrow({ where: { id: outcome.transactionId } })).toMatchObject({
      type: "TRANSFER",
      amountCents: -52000,
    });
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

describe("pairStagedRows", () => {
  /** A card payment as both banks report it, each on its own mapped account. */
  async function paymentLegs(opts: { inAmountCents?: number } = {}) {
    const item = await db.plaidItem.findFirstOrThrow({ where: { userId } });
    const chequing = await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } });
    const visa = await db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD" } });
    const leg = async (accountId: string, amountCents: number, day: string) => {
      seq += 1;
      const plaidAccount = await db.plaidAccount.create({
        data: { userId, plaidItemId: item.id, plaidAccountId: `acct-${seq}`, name: "x", plaidType: "depository", accountId },
      });
      const row = await db.plaidStagedTransaction.create({
        data: {
          userId,
          plaidItemId: item.id,
          plaidAccountRowId: plaidAccount.id,
          plaidTransactionId: `ptx-${seq}`,
          name: "PAYMENT",
          amountCents,
          type: "TRANSFER",
          date: new Date(`${day}T00:00:00Z`),
          suggestedAccountId: accountId,
        },
        select: COMMITTABLE_STAGED_SELECT,
      });
      return toCommittable(row);
    };
    const out = await leg(chequing.id, 50000, "2026-09-30");
    const arrived = await leg(visa.id, opts.inAmountCents ?? -50000, "2026-10-01");
    const transferCategoryId = (await db.category.create({ data: { userId, name: "Transfers", kind: "TRANSFER" } })).id;
    return { out, arrived, chequing, visa, transferCategoryId };
  }

  it("adds both legs as transfers that point at each other and name the other's account", async () => {
    const { out, arrived, chequing, visa, transferCategoryId } = await paymentLegs();
    const outcome = await db.$transaction((tx) =>
      pairStagedRows(tx, {
        userId,
        legs: [
          { staged: out, proposal: { title: "Visa payment", note: null } },
          { staged: arrived, proposal: { title: "Payment received", note: null } },
        ],
        categoryId: transferCategoryId,
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [outTx, inTx] = await Promise.all(
      outcome.transactionIds.map((id) => db.transaction.findUniqueOrThrow({ where: { id }, include: { verification: true } })),
    );
    expect(outTx).toMatchObject({
      type: "TRANSFER",
      amountCents: 50000,
      accountId: chequing.id,
      transferAccountId: visa.id,
      transferPeerId: inTx.id,
    });
    expect(inTx).toMatchObject({
      type: "TRANSFER",
      amountCents: -50000,
      accountId: visa.id,
      transferAccountId: chequing.id,
      transferPeerId: outTx.id,
    });
    expect(outTx.verification).not.toBeNull();
    expect(inTx.verification).not.toBeNull();
    const statuses = await db.plaidStagedTransaction.findMany({ where: { id: { in: [out.id, arrived.id] } } });
    expect(statuses.map((r) => r.status)).toEqual(["ADDED", "ADDED"]);
  });

  it("refuses two rows that cannot be one transfer, writing nothing", async () => {
    const { out, arrived, transferCategoryId } = await paymentLegs({ inAmountCents: -49000 });
    const before = await db.transaction.count({ where: { userId } });
    const outcome = await db.$transaction((tx) =>
      pairStagedRows(tx, {
        userId,
        legs: [
          { staged: out, proposal },
          { staged: arrived, proposal },
        ],
        categoryId: transferCategoryId,
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "not-a-pair" });
    expect(await db.transaction.count({ where: { userId } })).toBe(before);
  });

  it("reports a leg someone already reviewed, so the caller rolls the other back", async () => {
    const { out, arrived, transferCategoryId } = await paymentLegs();
    await db.$transaction((tx) => ignoreStagedRow(tx, { userId, stagedId: arrived.id }));
    const before = await db.transaction.count({ where: { userId } });
    await expect(
      db.$transaction(async (tx) => {
        const outcome = await pairStagedRows(tx, {
          userId,
          legs: [
            { staged: out, proposal },
            { staged: arrived, proposal },
          ],
          categoryId: transferCategoryId,
        });
        if (!outcome.ok) throw new Error(outcome.reason);
      }),
    ).rejects.toThrow("already-reviewed");
    expect(await db.transaction.count({ where: { userId } })).toBe(before);
    expect((await db.plaidStagedTransaction.findUniqueOrThrow({ where: { id: out.id } })).status).toBe("NEEDS_REVIEW");
  });
});
