import { describe, expect, it } from "vitest";
import { buildRegister, moneyInOut } from "./account-register";
import type { ReconcileTx } from "./reconciliation";

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function tx(id: string, ymd: string, type: ReconcileTx["type"], amountCents: number, extra: Partial<ReconcileTx> = {}): ReconcileTx {
  return {
    id,
    type,
    amountCents,
    date: day(ymd),
    title: id,
    categoryName: "Other",
    accountId: "chq",
    transferAccountId: null,
    transferPeerId: null,
    owedShares: [],
    ...extra,
  };
}

const balances = (rows: ReturnType<typeof buildRegister>) => rows.map((r) => [r.id, r.balanceCents, r.afterReading]);

describe("account register", () => {
  const txs = [
    tx("pay", "2026-10-01", "INCOME", 200_000),
    tx("rent", "2026-10-02", "EXPENSE", 150_000),
    tx("groceries", "2026-10-10", "EXPENSE", 8_000),
    tx("coffee", "2026-10-12", "EXPENSE", 500),
    // Booked on another account, arriving here.
    tx("from savings", "2026-10-05", "TRANSFER", 30_000, { accountId: "sav", transferAccountId: "chq" }),
    tx("elsewhere", "2026-10-06", "EXPENSE", 999, { accountId: "sav" }),
  ];

  it("walks back from the latest reading and forward past it, newest first", () => {
    const rows = buildRegister({ accountId: "chq", liability: false, transactions: txs, reading: { cents: 100_000, date: day("2026-10-10") } });
    expect(balances(rows)).toEqual([
      ["coffee", 99_500, true],
      ["groceries", 100_000, false],
      ["from savings", 108_000, false],
      ["rent", 78_000, false],
      ["pay", 228_000, false],
    ]);
  });

  it("raises what is owed on a card with each charge", () => {
    const card = [
      tx("lunch", "2026-10-03", "EXPENSE", 2_000, { accountId: "visa" }),
      tx("payment", "2026-10-04", "TRANSFER", 50_000, { accountId: "chq", transferAccountId: "visa" }),
      tx("books", "2026-10-08", "EXPENSE", 4_000, { accountId: "visa" }),
    ];
    const rows = buildRegister({ accountId: "visa", liability: true, transactions: card, reading: { cents: 30_000, date: day("2026-10-05") } });
    expect(balances(rows)).toEqual([
      ["books", 34_000, true],
      ["payment", 30_000, false],
      ["lunch", 80_000, false],
    ]);
  });

  it("shows no balances without a reading, and totals money in and out from a date", () => {
    const rows = buildRegister({ accountId: "chq", liability: false, transactions: txs, reading: null });
    expect(rows.every((r) => r.balanceCents === null && !r.afterReading)).toBe(true);
    expect(moneyInOut(rows, day("2026-10-02"))).toEqual({ inCents: 30_000, outCents: 158_500 });
  });
});
