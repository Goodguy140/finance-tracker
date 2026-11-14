import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The debt payoff plan for the phone, and setting a card's rate and minimum, against a real SQLite database. */

const dir = mkdtempSync(join(tmpdir(), "api-debt-payoff-"));
const url = `file:${join(dir, "debt.db")}`;
let db: PrismaClient;
let api: typeof import("./debt-payoff");
let edits: typeof import("./account-edits");
let data: typeof import("@/lib/debt-payoff-data");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./debt-payoff");
  edits = await import("./account-edits");
  data = await import("@/lib/debt-payoff-data");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

it("sets a card's and a loan's terms, and plans highest rate first, smallest first and minimums only from them", async () => {
  const user = await db.user.create({
    data: { email: "debt@example.test", displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  const userId = user.id;
  const yesterday = new Date(`${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
  const account = async (name: string, type: "CREDIT_CARD" | "LOAN" | "CHEQUING", balanceCents: number) => {
    const a = await db.account.create({ data: { userId, name, type } });
    await db.accountBalanceSnapshot.create({ data: { userId, accountId: a.id, date: yesterday, balanceCents, source: "MANUAL" } });
    return a.id;
  };
  const visa = await account("Visa", "CREDIT_CARD", 100_000);
  const loan = await account("Car loan", "LOAN", 300_000);
  await account("Store card", "CREDIT_CARD", 20_000);
  const chequing = await account("Chequing", "CHEQUING", 500_000);

  expect(await edits.patchAccountFromApi(db, userId, visa, { interestRateBps: 2_400, minimumPaymentCents: 5_000 })).toEqual({ ok: true, id: visa });
  expect(await edits.patchAccountFromApi(db, userId, loan, { interestRateBps: 600 })).toEqual({ ok: true, id: loan });
  // One field at a time keeps the other.
  expect(await edits.patchAccountFromApi(db, userId, loan, { minimumPaymentCents: 10_000 })).toEqual({ ok: true, id: loan });
  expect(await db.account.findUniqueOrThrow({ where: { id: loan }, select: { interestRateBps: true, minimumPaymentCents: true } })).toEqual({
    interestRateBps: 600,
    minimumPaymentCents: 10_000,
  });
  expect(await edits.patchAccountFromApi(db, userId, chequing, { interestRateBps: 100 })).toEqual({
    ok: false,
    status: 400,
    error: "Only credit cards and loans have a payoff plan.",
  });
  expect(await edits.patchAccountFromApi(db, userId, visa, { interestRateBps: 10_001 })).toMatchObject({ ok: false, status: 400 });

  // Asking for less than the minimums pays the minimums.
  const least = api.serializeDebtPayoff(await data.loadDebtPayoff(user, 1_000));
  expect(least).toMatchObject({ currency: "CAD", totalOwedCents: 420_000, minimumsCents: 15_000, monthlyCents: 15_000, missing: ["Store card"] });
  expect(least.accounts.map((a) => [a.name, a.owed?.cents, a.interestRateBps])).toEqual([
    ["Car loan", 300_000, 600],
    ["Store card", 20_000, null],
    ["Visa", 100_000, 2_400],
  ]);

  const plan = api.serializeDebtPayoff(await data.loadDebtPayoff(user, 30_000));
  const [avalanche, snowball, minimums] = plan.strategies;
  expect(plan.strategies.map((s) => s.id)).toEqual(["avalanche", "snowball", "minimums"]);
  expect(avalanche.payoffOrder.map((p) => p.name)).toEqual(["Visa", "Car loan", "Store card"]);
  expect(snowball.payoffOrder[0].name).toBe("Store card");
  expect(avalanche.totalInterestCents).toBeLessThan(snowball.totalInterestCents);
  // The store card has no minimum, so minimums alone never clear it.
  expect(minimums).toMatchObject({ months: null, debtFree: null });
  expect(avalanche.months).toBe(avalanche.payoffOrder.at(-1)?.month);
  expect(avalanche.debtFree).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  expect(avalanche.payoffOrder[0].label).toMatch(/^[A-Z][a-z]+ \d{4}$/);
});

it("reads the monthly amount as whole cents only", () => {
  expect(api.monthlyCentsParam("25000")).toBe(25_000);
  expect(api.monthlyCentsParam("250.00")).toBeNull();
  expect(api.monthlyCentsParam(null)).toBeNull();
});
