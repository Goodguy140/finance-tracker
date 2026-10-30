import { describe, expect, it } from "vitest";
import { buildRegister } from "@/lib/account-register";
import type { ProjectedBalances } from "@/lib/projected-balances";
import type { ReconcileTx } from "@/lib/reconciliation";
import { firstBelowZero, lowestBalanceByMonth, monthEndReadings, netWorthMovement, paymentsIntoByMonth } from "./financial-score-inputs";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
let id = 0;
const entry = (date: string, type: ReconcileTx["type"], amountCents: number, accountId: string | null, transferAccountId: string | null = null): ReconcileTx => ({
  id: `t${++id}`,
  type,
  amountCents,
  date: d(date),
  title: null,
  categoryName: "x",
  accountId,
  transferAccountId,
  transferPeerId: null,
  owedShares: [],
});

describe("lowestBalanceByMonth", () => {
  it("finds each month's lowest combined balance from the registers", () => {
    const txs = [
      entry("2026-08-01", "INCOME", 300_000, "chq"),
      entry("2026-08-03", "EXPENSE", 250_000, "chq"),
      entry("2026-09-01", "INCOME", 300_000, "chq"),
      entry("2026-09-20", "EXPENSE", 100_000, "chq"),
    ];
    const reading = { cents: 300_000, date: d("2026-09-30") };
    const chq = { reading, rows: buildRegister({ accountId: "chq", liability: false, transactions: txs, reading }) };
    // Walked back from 300,000: Aug 1 closes at 350,000 and Aug 3 at 100,000, which holds to the
    // end of August; September closes at 400,000, then 300,000 from the 20th.
    const cash = { reading: { cents: 2_000 }, rows: [] };
    expect(lowestBalanceByMonth([chq, cash], ["2026-08", "2026-09"])).toEqual(
      new Map([
        ["2026-08", 102_000],
        ["2026-09", 302_000],
      ]),
    );
    expect(lowestBalanceByMonth([{ reading: null, rows: [] }], ["2026-09"])).toBeNull();
  });

  it("closes a day on its last entry when several land the same day", () => {
    // Pay, rent and groceries all on the 5th; the reading that day is after all three.
    const txs = [entry("2026-09-05", "INCOME", 400_000, "chq"), entry("2026-09-05", "EXPENSE", 300_000, "chq"), entry("2026-09-05", "EXPENSE", 60_000, "chq")];
    const reading = { cents: 330_000, date: d("2026-09-05") };
    const rows = buildRegister({ accountId: "chq", liability: false, transactions: txs, reading });
    // 290,000 until the 5th, then 330,000: never one of the day's in-between balances.
    expect(lowestBalanceByMonth([{ reading, rows }], ["2026-09"])).toEqual(new Map([["2026-09", 290_000]]));
  });
});

describe("paymentsIntoByMonth", () => {
  it("counts transfers arriving in a loan, not charges on it", () => {
    const txs = [
      entry("2026-08-15", "TRANSFER", 40_000, "chq", "loan"),
      entry("2026-09-15", "TRANSFER", -10_000, "loan"),
      entry("2026-09-16", "EXPENSE", 5_000, "loan"),
      entry("2026-09-17", "TRANSFER", 7_000, "chq", "other"),
    ];
    expect(paymentsIntoByMonth(txs, "loan")).toEqual(
      new Map([
        ["2026-08", 40_000],
        ["2026-09", 10_000],
      ]),
    );
  });
});

describe("monthEndReadings", () => {
  it("takes each month's last reading, oldest first", () => {
    const r = (date: string, cents: number) => ({ accountId: "a", date: d(date), cents, source: "MANUAL" as const });
    expect(monthEndReadings([r("2026-09-02", 5), r("2026-07-28", 1), r("2026-09-25", 7)], ["2026-07", "2026-08", "2026-09"])).toEqual([1, 7]);
  });
});

describe("netWorthMovement", () => {
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const accounts = [
    { id: "sav", name: "Savings", liability: false },
    { id: "card", name: "Visa", liability: true },
  ];
  const r = (accountId: string, date: string, cents: number) => ({ accountId, date: d(date), cents, source: "MANUAL" as const });

  it("compares the first and last months and names the biggest loss", () => {
    const readings = [r("sav", "2026-04-20", 500_000), r("sav", "2026-09-20", 450_000), r("card", "2026-04-20", 10_000), r("card", "2026-09-20", 90_000)];
    expect(netWorthMovement({ accounts, readings, months })).toEqual({
      startYm: "2026-04",
      startCents: 490_000,
      endCents: 360_000,
      biggestDrop: { name: "Visa", cents: 80_000 },
    });
  });

  it("needs a reading at the start and a recent one, never one old reading carried forward", () => {
    expect(netWorthMovement({ accounts, readings: [r("sav", "2026-03-20", 500_000)], months })).toBeNull();
    expect(netWorthMovement({ accounts, readings: [r("sav", "2026-09-01", 500_000)], months })).toBeNull();
    expect(netWorthMovement({ accounts, readings: [r("sav", "2026-04-01", 1), r("sav", "2026-09-01", 2)], months: months.slice(-3) })).toBeNull();
  });
});

describe("firstBelowZero", () => {
  const account = (name: string, asOf: string, belowZero: string | null): ProjectedBalances["accounts"][number] => ({
    accountId: name,
    name,
    liability: false,
    currentCents: 10_000,
    asOf: d(asOf),
    projectedCents: [0],
    belowZero: belowZero ? { date: d(belowZero), cause: "Rent", lowestCents: -5_000 } : null,
  });
  const projection = (accounts: ProjectedBalances["accounts"]): ProjectedBalances => ({
    netCents: [0, 0],
    accounts,
    rulesLeftOut: 0,
    includesTransfers: false,
    transfersLeftOut: 0,
  });
  const fmt = (date: Date) => date.toISOString().slice(0, 10);

  it("gives the earliest dip among accounts read recently", () => {
    const result = firstBelowZero(
      projection([account("Old", "2026-08-01", "2026-10-09"), account("Chequing", "2026-10-01", "2026-10-21"), account("Joint", "2026-10-02", "2026-11-30")]),
      "2026-10-07",
      31,
      fmt,
    );
    expect(result).toEqual({ belowZero: { accountName: "Chequing", days: 14, dateLabel: "2026-10-21", cause: "Rent" } });
    expect(firstBelowZero(projection([account("Chequing", "2026-10-01", null)]), "2026-10-07", 31, fmt)).toEqual({ belowZero: null });
    expect(firstBelowZero(projection([account("Old", "2026-08-01", null)]), "2026-10-07", 31, fmt)).toBeNull();
  });
});
