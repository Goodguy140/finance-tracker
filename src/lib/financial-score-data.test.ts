import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shiftYm } from "@/lib/dashboard-period";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * The score's loader against a real SQLite database built from the migrations: what it reads
 * is decided by its queries, so that is where it has to be tested.
 */

const dir = mkdtempSync(join(tmpdir(), "financial-score-data-"));
const url = `file:${join(dir, "score.db")}`;
let db: PrismaClient;
let loadFinancialScore: typeof import("./financial-score-data").loadFinancialScore;

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  ({ loadFinancialScore } = await import("./financial-score-data"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("loadFinancialScore", () => {
  it("weighs only home-currency bills against home-currency income", async () => {
    const userId = (await db.user.create({ data: { email: "score@example.test", displayName: "Test", countryCode: "CA" } })).id;
    const [cad, usd] = await Promise.all([
      db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING", currency: "CAD" } }),
      db.account.create({ data: { userId, name: "US card", type: "CREDIT_CARD", currency: "USD" } }),
    ]);
    const [rent, salary] = await Promise.all([
      db.category.create({ data: { userId, name: "Rent", kind: "EXPENSE" } }),
      db.category.create({ data: { userId, name: "Salary", kind: "INCOME" } }),
    ]);
    // $4,000 of CAD income in each of the last few full months.
    const thisYm = currentYmdInTimeZone(null).slice(0, 7);
    await db.transaction.createMany({
      data: [1, 2, 3].map((back) => ({
        userId,
        accountId: cad.id,
        categoryId: salary.id,
        type: "INCOME" as const,
        amountCents: 400000,
        date: new Date(`${shiftYm(thisYm, -back)}-01T00:00:00Z`),
      })),
    });
    const rule = { userId, categoryId: rent.id, type: "EXPENSE" as const, cadence: "MONTHLY" as const, nextExpectedDate: new Date() };
    await db.recurringTransaction.createMany({
      data: [
        { ...rule, accountId: cad.id, name: "Rent", amountCents: 100000 },
        // In US dollars: adding it to CAD income at face value would make bills 100% of income.
        { ...rule, accountId: usd.id, name: "US storage", amountCents: 300000 },
      ],
    });

    const { score } = await loadFinancialScore({ id: userId, timezone: null, countryCode: "CA" });
    expect(score.status).toBe("scored");
    const bills = score.status === "scored" ? score.factors.find((f) => f.id === "bills") : undefined;
    expect(bills?.detail).toBe("25% of income goes to recurring bills");
  });

  it("names the accounts in another currency it leaves out", async () => {
    const userId = (await db.user.create({ data: { email: "score-fx@example.test", displayName: "Test", countryCode: "CA" } })).id;
    const [cad, usdCard, usdSavings] = await Promise.all([
      db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING", currency: "CAD" } }),
      db.account.create({ data: { userId, name: "US card", type: "CREDIT_CARD", currency: "USD" } }),
      db.account.create({ data: { userId, name: "US savings", type: "SAVINGS", currency: "USD" } }),
      // Another currency but unused and with no balance: nothing is left out of the score.
      db.account.create({ data: { userId, name: "Euro card", type: "CREDIT_CARD", currency: "EUR" } }),
    ]);
    const [food, salary] = await Promise.all([
      db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } }),
      db.category.create({ data: { userId, name: "Salary", kind: "INCOME" } }),
    ]);
    const lastYm = shiftYm(currentYmdInTimeZone(null).slice(0, 7), -1);
    const date = new Date(`${lastYm}-01T00:00:00Z`);
    await db.transaction.createMany({
      data: [
        { userId, accountId: cad.id, categoryId: salary.id, type: "INCOME" as const, amountCents: 400000, date },
        { userId, accountId: usdCard.id, categoryId: food.id, type: "EXPENSE" as const, amountCents: 5000, date },
      ],
    });
    await db.accountBalanceSnapshot.create({ data: { userId, accountId: usdSavings.id, date, balanceCents: 900000, source: "MANUAL" } });

    const { score } = await loadFinancialScore({ id: userId, timezone: null, countryCode: "CA" });
    expect(score.status === "scored" ? score.otherCurrencyAccounts : null).toEqual([
      { name: "US card", currency: "USD" },
      { name: "US savings", currency: "USD" },
    ]);
  });

  it("counts a carried card and a loan behind on its minimum, but not a card paid off or a loan on time", async () => {
    const userId = (await db.user.create({ data: { email: "score-debt@example.test", displayName: "Test", countryCode: "CA" } })).id;
    const thisYm = currentYmdInTimeZone(null).slice(0, 7);
    const day = (back: number, d = 10) => new Date(`${shiftYm(thisYm, -back)}-${String(d).padStart(2, "0")}T00:00:00Z`);
    const [chequing, visa, amex, car, student] = await Promise.all([
      db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } }),
      db.account.create({ data: { userId, name: "Visa", type: "CREDIT_CARD", creditLimitCents: 500000, interestRateBps: 2099 } }),
      db.account.create({ data: { userId, name: "Amex", type: "CREDIT_CARD" } }),
      db.account.create({ data: { userId, name: "Car loan", type: "LOAN", minimumPaymentCents: 40000 } }),
      db.account.create({ data: { userId, name: "Student loan", type: "LOAN", minimumPaymentCents: 20000 } }),
    ]);
    const [food, salary, transfers] = await Promise.all([
      db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } }),
      db.category.create({ data: { userId, name: "Salary", kind: "INCOME" } }),
      db.category.create({ data: { userId, name: "Transfers", kind: "TRANSFER" } }),
    ]);
    const move = (to: string, back: number, amountCents: number) => ({
      userId, accountId: chequing.id, transferAccountId: to, categoryId: transfers.id, type: "TRANSFER" as const, amountCents, date: day(back, 15),
    });
    await db.transaction.createMany({
      data: [
        ...[1, 2, 3].map((back) => ({ userId, accountId: chequing.id, categoryId: salary.id, type: "INCOME" as const, amountCents: 500000, date: day(back, 1) })),
        // $200 charged on each card last month.
        { userId, accountId: visa.id, categoryId: food.id, type: "EXPENSE" as const, amountCents: 20000, date: day(1) },
        { userId, accountId: amex.id, categoryId: food.id, type: "EXPENSE" as const, amountCents: 20000, date: day(1) },
        // The car loan got its minimum until last month, which got $100; the student loan is on time.
        move(car.id, 3, 40000),
        move(car.id, 2, 40000),
        move(car.id, 1, 10000),
        ...[1, 2, 3].map((back) => move(student.id, back, 20000)),
      ],
    });
    // Visa owes $2,200 against $200 of charges: carried. Amex owes only what was charged.
    const read = (accountId: string, balanceCents: number) => ({ userId, accountId, date: day(1, 20), balanceCents, source: "MANUAL" as const });
    await db.accountBalanceSnapshot.createMany({
      data: [read(visa.id, 220000), read(amex.id, 20000), read(car.id, 1500000), read(student.id, 900000)],
    });

    const { score } = await loadFinancialScore({ id: userId, timezone: null, countryCode: "CA" });
    if (score.status !== "scored") throw new Error("expected a score");
    const byId = Object.fromEntries(score.factors.map((f) => [f.id, f]));
    expect(byId.cards.detail).toBe("$2,000.00 carried on Visa, 44% of its limit");
    expect(byId.loans.detail).toBe("Car loan got less than its minimum in 1 of the last 3 months");
    expect(byId.loans.suggestion).toContain("but $100.00 went to it in");
    // The car loan's minimum counts as a commitment once it slips; the student loan's does not.
    expect(byId.bills.detail).toBe("8% of income goes to recurring bills and debt payments");
    expect(byId.fees.detail).toContain("interest and fees");
  });

  it("saves the score for its month once, and says how it moved since the month before", async () => {
    const userId = (await db.user.create({ data: { email: "score-history@example.test", displayName: "Test", countryCode: "CA", birthYear: 1990 } })).id;
    const thisYm = currentYmdInTimeZone(null).slice(0, 7);
    const lastYm = shiftYm(thisYm, -1);
    const [chequing, tfsa] = await Promise.all([
      db.account.create({ data: { userId, name: "Chequing", type: "CHEQUING" } }),
      db.account.create({ data: { userId, name: "TFSA", type: "TFSA" } }),
    ]);
    const salary = await db.category.create({ data: { userId, name: "Salary", kind: "INCOME" } });
    await db.transaction.create({
      data: { userId, accountId: chequing.id, categoryId: salary.id, type: "INCOME", amountCents: 400000, date: new Date(`${lastYm}-01T00:00:00Z`) },
    });
    await db.accountBalanceSnapshot.create({
      data: { userId, accountId: tfsa.id, date: new Date(`${lastYm}-20T00:00:00Z`), balanceCents: 2000000, source: "MANUAL" },
    });
    await db.financialScoreSnapshot.create({
      data: { userId, month: shiftYm(lastYm, -1), score: 40, factors: JSON.stringify({ savings: 50, longterm: 30 }) },
    });

    const { score } = await loadFinancialScore({ id: userId, timezone: null, countryCode: "CA" });
    if (score.status !== "scored") throw new Error("expected a score");
    expect(score.change?.fromScore).toBe(40);
    expect(score.change?.mover?.label).toBe("Savings rate");
    // With a birth year the long-term factor compares savings with age.
    expect(score.factors.find((f) => f.id === "longterm")?.detail).toMatch(/is typical at \d+\)$/);

    const saved = await db.financialScoreSnapshot.findUnique({ where: { userId_month: { userId, month: lastYm } } });
    expect(saved?.score).toBe(score.score);
    expect(JSON.parse(saved!.factors).savings).toBe(100);
  });
});
