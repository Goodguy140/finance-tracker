import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountType, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** Upcoming bills on the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-bills-forecast-"));
const url = `file:${join(dir, "forecast.db")}`;
let db: PrismaClient;
let api: typeof import("./bills-forecast");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./bills-forecast");
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
    data: { email: `forecast${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  const cat = async (name: string, kind: "EXPENSE" | "INCOME" | "TRANSFER") => (await db.category.create({ data: { userId: user.id, name, kind } })).id;
  const [housing, fun, pay, move] = await Promise.all([cat("Housing", "EXPENSE"), cat("Fun", "EXPENSE"), cat("Pay", "INCOME"), cat("Transfer", "TRANSFER")]);
  const account = async (name: string, type: AccountType, extra: Record<string, unknown> = {}) =>
    (await db.account.create({ data: { userId: user.id, name, type, currency: "CAD", ...extra } })).id;
  const chequing = await account("Chequing", "CHEQUING");
  const savings = await account("Savings", "SAVINGS");
  const visa = await account("Visa", "CREDIT_CARD", { paymentDueDay: 28, minimumPaymentCents: 2_500 });
  const amex = await account("Amex", "CREDIT_CARD", { paymentDueDay: 20 });
  await db.accountBalanceSnapshot.create({ data: { userId: user.id, accountId: visa, date: day("2026-03-01"), balanceCents: 40_000, source: "MANUAL" } });

  const rule = (data: Record<string, unknown>) =>
    db.recurringTransaction.create({
      data: { userId: user.id, accountId: chequing, cadence: "MONTHLY", enabled: true, ...data } as never,
    });
  await rule({ name: "Rent", type: "EXPENSE", categoryId: housing, amountCents: 150_000, nextExpectedDate: day("2026-03-15") });
  await rule({ name: "Streaming", type: "EXPENSE", categoryId: fun, amountCents: 1_500, nextExpectedDate: day("2026-03-12"), decideBy: day("2026-04-01") });
  await rule({ name: "Paycheque", type: "INCOME", categoryId: pay, amountCents: 300_000, nextExpectedDate: day("2026-03-20") });
  await rule({ name: "To savings", type: "TRANSFER", categoryId: move, transferAccountId: savings, amountCents: 50_000, nextExpectedDate: day("2026-03-25") });
  // Amex is paid by its own recurring transfer, so its due day is not listed again.
  await rule({ name: "Pay Amex", type: "TRANSFER", categoryId: move, transferAccountId: amex, amountCents: 10_000, nextExpectedDate: day("2026-03-19") });
  await rule({ name: "Old gym", type: "EXPENSE", categoryId: fun, amountCents: 4_000, nextExpectedDate: day("2026-03-11"), enabled: false });
  await db.plannedTransaction.create({
    data: { userId: user.id, accountId: chequing, categoryId: housing, type: "EXPENSE", name: "Car repair", amountCents: 80_000, date: day("2026-03-18") },
  });
});

const names = (r: Awaited<ReturnType<typeof api.loadAppBillsForecast>>) =>
  r.groups.map((g) => [g.date, g.runningNetCents, g.entries.map((e) => e.name)]);

describe("upcoming bills on the phone", () => {
  it("lists bills, pay, plans, transfers and card payments by day, with the running net only counting money in and out", async () => {
    const r = await api.loadAppBillsForecast(db, user, { days: 30, includeTransfers: true }, now);
    expect(r).toMatchObject({ today: "2026-03-10", currency: "CAD", days: 30, incomeCents: 300_000, expenseCents: 231_500, netCents: 68_500, sources: 7 });
    expect(names(r)).toEqual([
      ["2026-03-12", -1_500, ["Streaming"]],
      ["2026-03-15", -151_500, ["Rent"]],
      ["2026-03-18", -231_500, ["Car repair"]],
      ["2026-03-19", -231_500, ["Pay Amex"]],
      ["2026-03-20", 68_500, ["Paycheque"]],
      ["2026-03-25", 68_500, ["To savings"]],
      ["2026-03-28", 68_500, ["Visa payment"]],
    ]);
    const entries = r.groups.flatMap((g) => g.entries);
    expect(entries.find((e) => e.name === "Streaming")).toMatchObject({ type: "expense", label: "Fun", decideBy: "2026-04-01", planned: false });
    expect(entries.find((e) => e.name === "Car repair")).toMatchObject({ planned: true, label: "Housing" });
    expect(entries.find((e) => e.name === "To savings")).toMatchObject({ type: "transfer", label: "Chequing to Savings" });
    expect(entries.find((e) => e.name === "Visa payment")).toMatchObject({ amountCents: 40_000, card: { owedCents: 40_000, minimumCents: 2_500 } });
  });

  it("goes further out on request, with a subscription's decide-by date only on its first charge, and leaves moves out when asked", async () => {
    const r = await api.loadAppBillsForecast(db, user, { days: 60, includeTransfers: false }, now);
    const streaming = r.groups.flatMap((g) => g.entries.filter((e) => e.name === "Streaming").map((e) => [g.date, e.decideBy]));
    expect(streaming).toEqual([
      ["2026-03-12", "2026-04-01"],
      ["2026-04-12", null],
    ]);
    expect(r.groups.flatMap((g) => g.entries).some((e) => e.type === "transfer")).toBe(false);
    expect(r).toMatchObject({ incomeCents: 600_000, expenseCents: 383_000 });
  });

  it("takes 30, 60 or 90 days only", () => {
    expect(api.parseForecastQuery(new URLSearchParams(""))).toEqual({ ok: true, days: 30, includeTransfers: true });
    expect(api.parseForecastQuery(new URLSearchParams("days=90&transfers=false"))).toEqual({ ok: true, days: 90, includeTransfers: false });
    expect(api.parseForecastQuery(new URLSearchParams("days=45"))).toMatchObject({ ok: false });
  });
});
