import { describe, expect, it } from "vitest";
import type { RecurringCadence, TransactionType } from "@prisma/client";
import type { AccountBalanceRow } from "./net-worth";
import { projectBalances, type ProjectableRule } from "./projected-balances";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

function account(accountId: string, cents: number | null, overrides: Partial<AccountBalanceRow> & { asOf?: string } = {}): AccountBalanceRow {
  return {
    accountId,
    name: accountId,
    type: "CHEQUING",
    currency: "CAD",
    liability: false,
    latest: cents === null ? null : { cents, date: dateFromYmd(overrides.asOf ?? "2026-10-10"), source: "PLAID" },
    counted: true,
    ...overrides,
  };
}

function rule(accountId: string, next: string, amountCents: number, type: TransactionType = "EXPENSE", cadence: RecurringCadence = "MONTHLY"): ProjectableRule {
  return { accountId, type, amountCents, cadence, nextExpectedDate: dateFromYmd(next), endDate: null, enabled: true };
}

const TODAY = { todayYmd: "2026-10-10", currentYm: "2026-10" };

describe("projectBalances", () => {
  it("applies bills and income to their own account at 30, 60 and 90 days", () => {
    const result = projectBalances({
      ...TODAY,
      accounts: [account("chq", 500_000), account("sav", 1_000_000)],
      rules: [rule("chq", "2026-11-01", 150_000), rule("chq", "2026-10-15", 300_000, "INCOME"), rule("sav", "2026-10-20", 10_000, "INCOME")],
    });
    const chq = result.accounts.find((a) => a.accountId === "chq")!;
    // Pay Oct 15, Nov 15, Dec 15; rent Nov 1, Dec 1, Jan 1. Horizons end Nov 9, Dec 9, Jan 8.
    expect(chq.projectedCents).toEqual([650_000, 800_000, 950_000]);
    const sav = result.accounts.find((a) => a.accountId === "sav")!;
    expect(sav.projectedCents).toEqual([1_010_000, 1_020_000, 1_030_000]);
    expect(result.netCents).toEqual([1_500_000, 1_660_000, 1_820_000, 1_980_000]);
  });

  it("raises what is owed on a card with each bill and lowers it with a payment", () => {
    const result = projectBalances({
      ...TODAY,
      accounts: [account("chq", 100_000), account("card", 20_000, { type: "CREDIT_CARD", liability: true })],
      rules: [rule("card", "2026-10-20", 5_000), rule("card", "2026-10-25", 2_000, "INCOME")],
    });
    expect(result.accounts.find((a) => a.accountId === "card")!.projectedCents[0]).toBe(23_000);
    expect(result.netCents[0]).toBe(80_000);
    expect(result.netCents[1]).toBe(77_000);
  });

  it("skips occurrences already in the balance and flags an account that goes below zero", () => {
    const result = projectBalances({
      ...TODAY,
      accounts: [account("chq", 100_000, { asOf: "2026-10-05" })],
      // The Oct 3 occurrence predates the reading; the Oct 8 one does not.
      rules: [rule("chq", "2026-10-03", 30_000, "EXPENSE", "WEEKLY"), rule("chq", "2026-10-08", 80_000)],
    });
    const chq = result.accounts[0];
    // Oct 8 rent leaves $200, the weekly bill on Oct 10 takes it below zero. By Nov 9: five
    // weekly bills (Oct 10 to Nov 7) and two rents (Oct 8, Nov 8).
    expect(chq.projectedCents[0]).toBe(100_000 - 5 * 30_000 - 2 * 80_000);
    expect(chq.belowZero && ymdFromDateUtc(chq.belowZero.date)).toBe("2026-10-10");
    expect(chq.belowZero!.lowestCents).toBe(chq.projectedCents[2]);
  });

  it("leaves out accounts with no balance or in another currency, and counts their rules", () => {
    const result = projectBalances({
      ...TODAY,
      accounts: [account("chq", 100_000), account("none", null), account("usd", 50_000, { currency: "USD", counted: false })],
      rules: [rule("none", "2026-10-20", 1_000), rule("usd", "2026-10-20", 1_000), { ...rule("chq", "2026-10-20", 1_000), type: "TRANSFER_OUT" as TransactionType }],
    });
    expect(result.accounts.map((a) => a.accountId)).toEqual(["chq"]);
    expect(result.rulesLeftOut).toBe(2);
    // The transfer rule is not applied.
    expect(result.netCents).toEqual([100_000, 100_000, 100_000, 100_000]);
  });
});

describe("projectBalances belowZero", () => {
  it("names the rule whose occurrence first takes the account below zero", () => {
    const result = projectBalances({
      ...TODAY,
      accounts: [account("chq", 100_000)],
      rules: [{ ...rule("chq", "2026-10-20", 40_000), name: "Hydro" }, { ...rule("chq", "2026-11-01", 90_000), name: "Rent" }],
    });
    expect(result.accounts[0].belowZero).toMatchObject({ cause: "Rent" });
  });
});

describe("projectBalances with transfers", () => {
  function transfer(from: string, to: string | null, next: string, amountCents: number): ProjectableRule {
    return { ...rule(from, next, amountCents, "TRANSFER"), transferAccountId: to, name: "Move" };
  }
  const card = () => account("card", 50_000, { type: "CREDIT_CARD", liability: true });

  it("leaves transfers out unless asked", () => {
    const result = projectBalances({
      ...TODAY,
      accounts: [account("chq", 100_000), account("sav", 0)],
      rules: [transfer("chq", "sav", "2026-10-20", 20_000)],
    });
    expect(result.includesTransfers).toBe(false);
    expect(result.accounts.map((a) => a.projectedCents[0])).toEqual([100_000, 0]);
    expect(result.transfersLeftOut).toBe(0);
  });

  it("moves each transfer out of one account and into the other, leaving net worth alone", () => {
    const result = projectBalances({
      ...TODAY,
      includeTransfers: true,
      accounts: [account("chq", 100_000), account("sav", 0)],
      rules: [transfer("chq", "sav", "2026-10-20", 20_000)],
    });
    // Oct 20, Nov 20, Dec 20: one, two and three transfers by the 30, 60 and 90 day marks.
    expect(result.accounts.find((a) => a.accountId === "chq")!.projectedCents).toEqual([80_000, 60_000, 40_000]);
    expect(result.accounts.find((a) => a.accountId === "sav")!.projectedCents).toEqual([20_000, 40_000, 60_000]);
    expect(result.netCents).toEqual([100_000, 100_000, 100_000, 100_000]);
  });

  it("lowers what is owed on a card that a transfer pays, and raises it on one a transfer leaves", () => {
    const payment = projectBalances({
      ...TODAY,
      includeTransfers: true,
      accounts: [account("chq", 100_000), card()],
      rules: [transfer("chq", "card", "2026-10-20", 30_000)],
    });
    expect(payment.accounts.find((a) => a.accountId === "card")!.projectedCents[0]).toBe(20_000);
    expect(payment.accounts.find((a) => a.accountId === "chq")!.projectedCents[0]).toBe(70_000);
    expect(payment.netCents[1]).toBe(payment.netCents[0]);

    const advance = projectBalances({
      ...TODAY,
      includeTransfers: true,
      accounts: [account("chq", 100_000), card()],
      rules: [transfer("card", "chq", "2026-10-20", 10_000)],
    });
    expect(advance.accounts.find((a) => a.accountId === "card")!.projectedCents[0]).toBe(60_000);
    expect(advance.accounts.find((a) => a.accountId === "chq")!.projectedCents[0]).toBe(110_000);
  });

  it("flags the account a transfer takes below zero, naming the transfer", () => {
    const result = projectBalances({
      ...TODAY,
      includeTransfers: true,
      accounts: [account("chq", 10_000), account("sav", 0)],
      rules: [transfer("chq", "sav", "2026-10-20", 20_000)],
    });
    const chq = result.accounts.find((a) => a.accountId === "chq")!;
    expect(chq.belowZero).toMatchObject({ cause: "Move", lowestCents: -50_000 });
    expect(result.accounts.find((a) => a.accountId === "sav")!.belowZero).toBeNull();
  });

  it("applies each side only after that account's own balance was read", () => {
    const result = projectBalances({
      ...TODAY,
      includeTransfers: true,
      // Savings was read on Oct 25, after the Oct 20 transfer had arrived.
      accounts: [account("chq", 100_000), account("sav", 20_000, { asOf: "2026-10-25" })],
      rules: [transfer("chq", "sav", "2026-10-20", 20_000)],
    });
    expect(result.accounts.find((a) => a.accountId === "chq")!.projectedCents[0]).toBe(80_000);
    expect(result.accounts.find((a) => a.accountId === "sav")!.projectedCents[0]).toBe(20_000);
  });

  it("leaves out and counts a transfer with a side that has no balance or no account", () => {
    const result = projectBalances({
      ...TODAY,
      includeTransfers: true,
      accounts: [account("chq", 100_000), account("none", null)],
      rules: [transfer("chq", "none", "2026-10-20", 20_000), transfer("chq", null, "2026-10-20", 5_000), transfer("chq", "chq", "2026-10-20", 5_000)],
    });
    expect(result.accounts[0].projectedCents).toEqual([100_000, 100_000, 100_000]);
    expect(result.transfersLeftOut).toBe(3);
    expect(result.rulesLeftOut).toBe(0);
  });
});
