import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shiftYm } from "@/lib/dashboard-period";
import { currentYmdInTimeZone } from "@/lib/period-month";

/**
 * The score's loader against a real SQLite database built from the migrations: what it reads
 * is decided by its queries, so that is where it has to be tested.
 */

const dir = mkdtempSync(join(tmpdir(), "financial-score-data-"));
const url = `file:${join(dir, "score.db")}`;
let db: PrismaClient;
let loadFinancialScore: typeof import("./financial-score-data").loadFinancialScore;

beforeAll(async () => {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  ({ loadFinancialScore } = await import("./financial-score-data"));
}, 120_000);

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
});
