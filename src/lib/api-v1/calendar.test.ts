import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountType, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The Calendar card on the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-calendar-"));
const url = `file:${join(dir, "calendar.db")}`;
let db: PrismaClient;
let api: typeof import("./calendar");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./calendar");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const now = new Date("2026-03-10T12:00:00Z");
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

let seq = 0;
let user: { id: string; timezone: string; countryCode: string };

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `calendar${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  const food = (await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } })).id;
  const pay = (await db.category.create({ data: { userId: user.id, name: "Pay", kind: "INCOME" } })).id;
  const account = async (name: string, type: AccountType, extra: Record<string, unknown> = {}) =>
    (await db.account.create({ data: { userId: user.id, name, type, currency: "CAD", ...extra } })).id;
  const chequing = await account("Chequing", "CHEQUING");
  const usd = await account("US account", "CHEQUING", { currency: "USD" });
  const visa = await account("Visa", "CREDIT_CARD", { paymentDueDay: 28, minimumPaymentCents: 2_500 });
  await db.accountBalanceSnapshot.create({ data: { userId: user.id, accountId: visa, date: day("2026-03-01"), balanceCents: 40_000, source: "MANUAL" } });

  const tx = (type: "EXPENSE" | "INCOME", amountCents: number, date: string, accountId = chequing) =>
    db.transaction.create({ data: { userId: user.id, categoryId: type === "EXPENSE" ? food : pay, accountId, type, amountCents, date: day(date), title: "x" } });
  await tx("EXPENSE", 1_000, "2026-03-03");
  await tx("EXPENSE", 500, "2026-03-03");
  await tx("EXPENSE", 3_000, "2026-03-09");
  // A refund lowers the day's spending.
  await tx("EXPENSE", -200, "2026-03-09");
  await tx("INCOME", 250_000, "2026-03-05");
  // Another currency's spending stays out of the home-currency grid.
  await tx("EXPENSE", 99_999, "2026-03-04", usd);
  await tx("EXPENSE", 700, "2026-02-14");

  const rule = (name: string, nextExpectedDate: string, amountCents: number) =>
    db.recurringTransaction.create({
      data: { userId: user.id, accountId: chequing, categoryId: food, type: "EXPENSE", cadence: "MONTHLY", enabled: true, name, amountCents, nextExpectedDate: day(nextExpectedDate) },
    });
  await rule("Rent", "2026-03-15", 150_000);
  await rule("Phone", "2026-03-06", 6_000);
  await db.plannedTransaction.create({
    data: { userId: user.id, accountId: chequing, categoryId: food, type: "EXPENSE", name: "Car repair", amountCents: 80_000, date: day("2026-03-18") },
  });
});

describe("the calendar on the phone", () => {
  it("lays the month out by week with each day's spending and income, and what is still due", async () => {
    const r = await api.loadAppCalendar(db, user, null, now);
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ month: "2026-03", today: "2026-03-10", currency: "CAD", spentCents: 4_300, incomeCents: 250_000, busiest: "2026-03-09" });
    // March 2026 starts on a Sunday: five full weeks, no padding before the 1st.
    expect(r.weeks.map((w) => w.length)).toEqual([7, 7, 7, 7, 7]);
    expect(r.weeks[0][0]).toMatchObject({ date: "2026-03-01", day: 1, inMonth: true });
    expect(r.weeks[4][3]).toMatchObject({ date: "2026-04-01", inMonth: false, spentCents: 0, bills: [] });
    const cell = (date: string) => r.weeks.flat().find((d) => d.date === date)!;
    expect(cell("2026-03-03")).toMatchObject({ spentCents: 1_500, count: 2 });
    expect(cell("2026-03-09")).toMatchObject({ spentCents: 2_800, count: 2 });
    expect(cell("2026-03-04")).toMatchObject({ spentCents: 0, count: 0 });
    expect(cell("2026-03-06").bills).toEqual([{ name: "Phone", type: "expense", cents: 6_000, overdue: true, planned: false, cardPayment: false }]);
    expect(cell("2026-03-15").bills).toMatchObject([{ name: "Rent", overdue: false }]);
    expect(cell("2026-03-18").bills).toMatchObject([{ name: "Car repair", planned: true }]);
    expect(cell("2026-03-28").bills).toEqual([{ name: "Visa payment", type: "transfer", cents: 40_000, overdue: false, planned: false, cardPayment: true }]);
  });

  it("shows a past month from the log alone, and refuses a month it cannot read", async () => {
    const r = await api.loadAppCalendar(db, user, "2026-02", now);
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ month: "2026-02", spentCents: 700, incomeCents: 0 });
    expect(r.weeks.flat().some((d) => d.bills.length > 0)).toBe(false);
    expect(await api.loadAppCalendar(db, user, "2026-13", now)).toEqual({ ok: false, error: "'month' must be YYYY-MM." });
  });
});
