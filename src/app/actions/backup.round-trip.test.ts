import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { TRANSACTION_NOTE_MAX, TRANSACTION_TITLE_MAX } from "@/lib/text-limits";

/**
 * A backup has to come back as it went out. Export the account, restore the file into the same
 * account, and compare: anything a newer feature stores that the backup leaves out, or anything
 * an entry path saves that the restore check refuses, fails here.
 */

const dir = mkdtempSync(join(tmpdir(), "backup-round-trip-"));
const url = `file:${join(dir, "backup.db")}`;
let db: PrismaClient;
let actions: typeof import("./backup");
let backup: typeof import("@/lib/backup");
let api: typeof import("@/lib/api-v1/transactions");

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role: "USER"; passwordHash: null } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/recent-identity", () => ({ requireRecentIdentity: vi.fn(async () => ({ user: session.user })) }));
vi.mock("@/lib/plaid/service", () => ({ tryMakePlaidItemRevoker: vi.fn(async () => null) }));

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  actions = await import("./backup");
  backup = await import("@/lib/backup");
  api = await import("@/lib/api-v1/transactions");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function seedUser(email: string) {
  const user = await db.user.create({
    data: {
      email,
      displayName: "Round Trip",
      birthYear: 1988,
      zeroBasedBudgeting: true,
      projectionIncludesTransfers: true,
      digestFrequency: "WEEKLY",
      billReminderDays: 3,
    },
  });
  session.user = { id: user.id, email, role: "USER", passwordHash: null };
  return user;
}

async function restoreOwnBackup(userId: string) {
  const payload = await backup.buildUserBackupPayload(userId);
  const form = new FormData();
  form.set("backupJson", new File([JSON.stringify(payload)], "backup.json", { type: "application/json" }));
  return actions.importUserBackupAction(form);
}

describe("backup round trip", () => {
  it("restores what every entry path saved, including the longest text each allows", async () => {
    const user = await seedUser("long@example.test");
    await db.category.create({ data: { userId: user.id, name: "Other", kind: "EXPENSE" } });
    await db.account.create({ data: { userId: user.id, name: "Visa", type: "CREDIT_CARD" } });
    // A rule's note goes on top of whatever note the entry already has.
    await db.transactionRule.create({
      data: { userId: user.id, priority: 0, titleOperator: "CONTAINS", titlePattern: "x", appendNote: "from a rule" },
    });
    const viaApi = await api.createTransactionFromApi(db, { id: user.id, timezone: "UTC" }, {
      type: "expense",
      amount: "5",
      title: "x".repeat(TRANSACTION_TITLE_MAX),
      note: "n".repeat(TRANSACTION_NOTE_MAX),
    });
    expect(viaApi.ok).toBe(true);
    expect(await api.createTransactionFromApi(db, { id: user.id, timezone: "UTC" }, { type: "expense", amount: "5", title: "x".repeat(TRANSACTION_TITLE_MAX + 1) })).toMatchObject({
      ok: false,
      status: 400,
    });
    // Saved before the limits held everywhere (the API once took 200 and 2,000 characters).
    const other = await db.category.findFirstOrThrow({ where: { userId: user.id, name: "Other" } });
    await db.transaction.create({
      data: {
        userId: user.id,
        categoryId: other.id,
        type: "EXPENSE",
        amountCents: 700,
        date: new Date("2026-09-01T00:00:00Z"),
        title: "t".repeat(200),
        note: "o".repeat(2000),
      },
    });

    expect(await restoreOwnBackup(user.id)).toBeUndefined();

    const rows = await db.transaction.findMany({ where: { userId: user.id }, orderBy: { amountCents: "asc" } });
    expect(rows.map((row) => [row.title?.length, row.note?.length])).toEqual([
      [TRANSACTION_TITLE_MAX, TRANSACTION_NOTE_MAX],
      [TRANSACTION_TITLE_MAX, TRANSACTION_NOTE_MAX],
    ]);
  });

  it("keeps review status, cancel details, reconciliations, history and preferences", async () => {
    const user = await seedUser("features@example.test");
    const category = await db.category.create({ data: { userId: user.id, name: "Streaming", kind: "EXPENSE" } });
    const account = await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } });
    await db.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: category.id,
        type: "EXPENSE",
        amountCents: 1599,
        date: new Date("2026-10-02T00:00:00Z"),
        title: "Imported row",
        needsReview: true,
      },
    });
    await db.recurringTransaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: category.id,
        type: "EXPENSE",
        name: "Streamer",
        amountCents: 1599,
        cadence: "MONTHLY",
        nextExpectedDate: new Date("2026-11-02T00:00:00Z"),
        enabled: false,
        cancelUrl: "https://example.test/cancel",
        decideBy: new Date("2026-11-20T00:00:00Z"),
        cancelledAt: new Date("2026-10-25T00:00:00Z"),
      },
    });
    await db.accountReconciliation.create({
      data: {
        userId: user.id,
        accountId: account.id,
        startDate: new Date("2026-09-01T00:00:00Z"),
        endDate: new Date("2026-09-30T00:00:00Z"),
        openingCents: 10_000,
        closingCents: 8_401,
      },
    });
    await db.monthClose.create({ data: { userId: user.id, ym: "2026-09" } });
    await db.financialScoreSnapshot.create({
      data: { userId: user.id, month: "2026-09", score: 64, factors: JSON.stringify({ savings: 72, cards: 40 }) },
    });
    await db.chargeAlertSetting.create({
      data: { userId: user.id, thresholdCents: 50_000, unusual: true, checkedThrough: new Date("2026-10-01T00:00:00Z") },
    });

    expect(await restoreOwnBackup(user.id)).toBeUndefined();

    expect(await db.transaction.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ needsReview: true });
    expect(await db.recurringTransaction.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      cancelUrl: "https://example.test/cancel",
      decideBy: new Date("2026-11-20T00:00:00Z"),
      cancelledAt: new Date("2026-10-25T00:00:00Z"),
    });
    const restoredAccount = await db.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(await db.accountReconciliation.findMany({ where: { userId: user.id } })).toMatchObject([
      { accountId: restoredAccount.id, openingCents: 10_000, closingCents: 8_401 },
    ]);
    expect(await db.monthClose.findMany({ where: { userId: user.id } })).toMatchObject([{ ym: "2026-09" }]);
    const [snapshot] = await db.financialScoreSnapshot.findMany({ where: { userId: user.id } });
    expect([snapshot?.month, snapshot?.score, JSON.parse(snapshot?.factors ?? "null")]).toEqual(["2026-09", 64, { savings: 72, cards: 40 }]);
    expect(await db.chargeAlertSetting.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      thresholdCents: 50_000,
      unusual: true,
    });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      birthYear: 1988,
      zeroBasedBudgeting: true,
      projectionIncludesTransfers: true,
      digestFrequency: "WEEKLY",
      billReminderDays: 3,
    });
  });

  it("clears score history and closed months on a reset, and records the reset", async () => {
    const user = await seedUser("reset@example.test");
    await db.monthClose.create({ data: { userId: user.id, ym: "2026-09" } });
    await db.financialScoreSnapshot.create({ data: { userId: user.id, month: "2026-09", score: 50, factors: "{}" } });
    const form = new FormData();
    form.set("confirmation", "RESET FINANCIAL DATA");

    expect(await actions.clearUserFinancialDataAction(form)).toBeUndefined();

    expect(await db.monthClose.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.financialScoreSnapshot.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { userId: user.id, action: "user_financial_data_reset" } })).toBe(1);
  });
});
