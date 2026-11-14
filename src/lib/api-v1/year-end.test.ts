import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The year-end summary for the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-year-end-"));
const url = `file:${join(dir, "year-end.db")}`;
let db: PrismaClient;
let api: typeof import("./year-end");
let data: typeof import("@/lib/reports/year-summary-data");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./year-end");
  data = await import("@/lib/reports/year-summary-data");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

it("shows last year by default, with tax-looking tags first and registered accounts' contributions", async () => {
  const user = await db.user.create({
    data: { email: "year-end@example.test", displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  const userId = user.id;
  const food = await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } });
  const pay = await db.category.create({ data: { userId, name: "Pay", kind: "INCOME" } });
  const rrsp = await db.account.create({ data: { userId, name: "My RRSP", type: "RRSP" } });
  const trip = await db.tag.create({ data: { userId, name: "Trip", nameKey: "trip" } });
  const deductible = await db.tag.create({ data: { userId, name: "Tax deductible", nameKey: "tax deductible" } });
  const entry = async (type: "EXPENSE" | "INCOME", amountCents: number, ymd: string, tagId?: string) => {
    const tx = await db.transaction.create({
      data: { userId, type, amountCents, categoryId: type === "EXPENSE" ? food.id : pay.id, title: "Shop", date: new Date(`${ymd}T00:00:00Z`) },
    });
    if (tagId) await db.transactionTag.create({ data: { transactionId: tx.id, tagId } });
  };
  await entry("EXPENSE", 40_000, "2024-05-01");
  await entry("INCOME", 300_000, "2025-01-15");
  await entry("EXPENSE", 20_000, "2025-03-10", trip.id);
  await entry("EXPENSE", 5_000, "2025-04-02", deductible.id);
  await entry("EXPENSE", 25_000, "2025-04-20");
  await db.investmentFlow.create({ data: { userId, accountId: rrsp.id, date: new Date("2025-02-01T00:00:00Z"), direction: "CONTRIBUTION", amountCents: 100_000 } });
  await db.investmentFlow.create({ data: { userId, accountId: rrsp.id, date: new Date("2026-01-05T00:00:00Z"), direction: "CONTRIBUTION", amountCents: 9_000 } });
  const now = new Date("2026-03-10T12:00:00Z");

  const last = api.serializeYearEnd(await data.loadYearEndReport(user, undefined, now));
  expect(last).toMatchObject({
    years: ["2026", "2025", "2024"],
    year: 2025,
    toDate: false,
    from: "2025-01-01",
    to: "2025-12-31",
    totals: { incomeCents: 300_000, spendingCents: 50_000, netCents: 250_000, entries: 4 },
    // 50,000 against 40,000 the year before.
    spendingChangePercent: 25,
    biggestMonth: { month: "2025-04", spendingCents: 30_000 },
  });
  expect(last.months).toHaveLength(12);
  expect(last.tags.map((t) => [t.name, t.taxRelated, t.spentCents])).toEqual([
    ["Tax deductible", true, 5_000],
    ["Trip", false, 20_000],
  ]);
  expect(last.registered).toEqual([
    { accountId: rrsp.id, name: "My RRSP", typeLabel: "RRSP", contributedCents: 100_000, withdrawnCents: 0 },
  ]);

  // The year now running is to today; a year with no activity is last year again.
  const running = api.serializeYearEnd(await data.loadYearEndReport(user, "2026", now));
  expect(running).toMatchObject({ year: 2026, toDate: true, to: "2026-03-10", totals: { entries: 0 } });
  expect(running.months).toHaveLength(3);
  expect(running.registered[0]).toMatchObject({ contributedCents: 9_000 });
  expect(api.serializeYearEnd(await data.loadYearEndReport(user, "1999", now)).year).toBe(2025);
});
