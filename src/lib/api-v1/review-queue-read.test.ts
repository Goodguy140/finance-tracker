import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * The phone's queue against a real database: what `GET /api/v1/review-queue` reads, and that a
 * decision made the way the API makes it takes the row out of it.
 */

vi.mock("@/lib/webhooks", () => ({ emitTransactionsCreated: vi.fn() }));
vi.mock("@/lib/budget-alert-dispatch", () => ({ scheduleBudgetAlertEmails: vi.fn() }));

const dir = mkdtempSync(join(tmpdir(), "review-queue-api-"));
const url = `file:${join(dir, "queue.db")}`;
let db: PrismaClient;
let api: typeof import("./review-queue");
let decisions: typeof import("@/lib/plaid/review-decisions");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./review-queue");
  decisions = await import("@/lib/plaid/review-decisions");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

it("lists every waiting row newest first with the bank's state, and drops a row once decided", async () => {
  const userId = (await db.user.create({ data: { email: "queue@example.test", displayName: "Test" } })).id;
  const accountId = (await db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } })).id;
  const groceries = await db.category.create({ data: { userId, name: "Groceries", kind: "EXPENSE" } });
  const item = await db.plaidItem.create({
    data: {
      userId,
      itemId: "item-queue",
      institutionName: "Tangerine",
      accessTokenEnc: "x",
      requestedDays: 90,
      historyCutoff: new Date("2026-06-01T00:00:00Z"),
      status: "LOGIN_REQUIRED",
    },
  });
  const plaidAccount = await db.plaidAccount.create({
    data: { userId, plaidItemId: item.id, plaidAccountId: "pa-queue", name: "Chequing", plaidType: "depository", accountId },
  });
  const staged = (id: string, date: string, status: "NEEDS_REVIEW" | "IGNORED" = "NEEDS_REVIEW") =>
    db.plaidStagedTransaction.create({
      data: {
        userId,
        plaidItemId: item.id,
        plaidAccountRowId: plaidAccount.id,
        plaidTransactionId: id,
        name: `LOBLAWS ${id}`,
        amountCents: 4200,
        type: "EXPENSE",
        date: new Date(`${date}T00:00:00Z`),
        suggestedCategoryId: groceries.id,
        suggestedAccountId: accountId,
        status,
      },
    });
  // Months apart: the phone shows every period at once, unlike the dashboard's month.
  const older = await staged("older", "2026-08-02");
  const newer = await staged("newer", "2026-11-01");
  await staged("ignored", "2026-11-02", "IGNORED");

  const queue = await api.reviewQueueForApi(db, userId);
  expect(queue.total).toBe(2);
  expect(queue.rows.map((row) => row.id)).toEqual([newer.id, older.id]);
  expect(queue.rows[0]).toMatchObject({ account: "Chequing", direction: "out", suggestedCategoryId: groceries.id, type: "expense" });
  expect(queue.categories.expense).toEqual([{ id: groceries.id, name: "Groceries" }]);
  expect(queue.banks).toEqual([
    expect.objectContaining({ name: "Tangerine", attention: expect.objectContaining({ kind: "reauth", actionLabel: "Sign in again" }) }),
  ]);

  const decision = api.parseDecisionBody({ decision: "add", countAs: "transfer" });
  if (!decision.ok) throw new Error(decision.error);
  const { transactionId } = await decisions.decideStagedRow(userId, newer.id, decision.value);
  expect(await db.transaction.findUnique({ where: { id: transactionId! }, select: { type: true } })).toEqual({ type: "TRANSFER" });

  const after = await api.reviewQueueForApi(db, userId);
  expect(after.rows.map((row) => row.id)).toEqual([older.id]);
  await expect(decisions.decideStagedRow(userId, newer.id, { decision: "ignore" })).rejects.toThrow("already been reviewed");
});
