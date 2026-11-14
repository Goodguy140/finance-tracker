import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The Reports page for the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-reports-"));
const url = `file:${join(dir, "reports.db")}`;
let db: PrismaClient;
let api: typeof import("./reports");
let overview: typeof import("@/lib/reports/overview");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./reports");
  overview = await import("@/lib/reports/overview");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// Days in this month and last, so they fall in the default last 12 months whenever this runs.
const today = currentYmdInTimeZone("UTC");
const thisMonth = today.slice(0, 7);
const lastMonth = (() => {
  const [y, m] = thisMonth.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();

let seq = 0;
let user: { id: string; timezone: string; countryCode: string };
let food: string;
let pay: string;
let move: string;
let chequing: string;
let savings: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `reports${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  food = (await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } })).id;
  pay = (await db.category.create({ data: { userId: user.id, name: "Pay", kind: "INCOME" } })).id;
  move = (await db.category.create({ data: { userId: user.id, name: "Transfers", kind: "TRANSFER" } })).id;
  chequing = (await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } })).id;
  savings = (await db.account.create({ data: { userId: user.id, name: "Savings", type: "SAVINGS", countsAsSavings: true } })).id;
});

function entry(categoryId: string, type: "EXPENSE" | "INCOME" | "TRANSFER", amountCents: number, day: string, extra: Record<string, unknown> = {}) {
  return db.transaction.create({
    data: { userId: user.id, categoryId, type, amountCents, accountId: chequing, date: new Date(`${day}T00:00:00Z`), title: "Row", ...extra },
  });
}

async function reports(params: Record<string, string> = {}, tagId: string | null = null) {
  const key = api.reportsPeriodKey(new URLSearchParams(params));
  return api.serializeReports(await overview.loadReportsOverview(user, key, tagId));
}

describe("the Reports page for the phone", () => {
  it("adds up the period as the website does: left over, and saved by transfer into savings", async () => {
    await entry(pay, "INCOME", 300_000, `${lastMonth}-01`);
    await entry(food, "EXPENSE", 40_000, `${lastMonth}-03`, { title: "Metro" });
    await entry(food, "EXPENSE", 10_000, `${thisMonth}-01`, { title: "Metro" });
    await entry(move, "TRANSFER", 50_000, `${lastMonth}-05`, { transferAccountId: savings });

    const out = await reports();
    expect(out.period).toMatchObject({ key: "12m", toDate: true, custom: false });
    expect(out.totals).toEqual({ incomeCents: 300_000, spendingCents: 50_000, netCents: 250_000, toSavingsCents: 50_000 });
    // From the first month with anything in it.
    expect(out.months.map((m) => [m.ym, m.incomeCents, m.spendingCents, m.toSavingsCents])).toEqual([
      [lastMonth, 300_000, 40_000, 50_000],
      [thisMonth, 0, 10_000, 0],
    ]);
    expect(out.payees).toMatchObject([{ name: "Metro", count: 2, spentCents: 50_000 }]);
    expect(out.cashFlow.uses.find((u) => u.kind === "expense")).toMatchObject({ name: "Food", cents: 50_000 });
    expect(out.yearOverYear.rows).toMatchObject([{ categoryName: "Food", currentCents: 50_000, previousCents: 0 }]);
  });

  it("narrows to a custom range and to a tag", async () => {
    const tag = (await db.tag.create({ data: { userId: user.id, name: "trip", nameKey: "trip" } })).id;
    const tagged = await entry(food, "EXPENSE", 7_000, `${lastMonth}-10`);
    await db.transactionTag.create({ data: { transactionId: tagged.id, tagId: tag } });
    await entry(food, "EXPENSE", 3_000, `${thisMonth}-01`);

    const range = await reports({ from: `${thisMonth}-01`, to: `${thisMonth}-01` });
    expect(range.period).toMatchObject({ from: `${thisMonth}-01`, to: `${thisMonth}-01`, custom: true });
    expect(range.totals.spendingCents).toBe(3_000);
    expect((await reports({}, tag)).totals.spendingCents).toBe(7_000);
  });

  it("projects balances from the latest reading, and says when an account goes below zero", async () => {
    expect((await reports()).projection).toBeNull();
    await db.accountBalanceSnapshot.create({ data: { userId: user.id, accountId: chequing, date: new Date(`${today}T00:00:00Z`), balanceCents: 50_000, source: "MANUAL" } });
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 10);
    await db.recurringTransaction.create({
      data: { userId: user.id, accountId: chequing, categoryId: food, type: "EXPENSE", name: "Rent", amountCents: 120_000, cadence: "MONTHLY", nextExpectedDate: due },
    });
    const out = await reports();
    expect(out.projection?.netCents[0]).toBe(50_000);
    expect(out.projection?.accounts[0]).toMatchObject({ name: "Chequing", currentCents: 50_000, belowZero: { lowestCents: expect.any(Number) } });
    expect(out.projection!.accounts[0].projectedCents[0]).toBe(-70_000);
  });
});
