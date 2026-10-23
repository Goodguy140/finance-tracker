import { describe, expect, it } from "vitest";
import { moneyIntoAccount, parseBalanceInput, reconcile, type ReconcileTx } from "./reconciliation";

const base = {
  title: null,
  categoryName: "Other",
  accountId: "chq",
  transferAccountId: null,
  transferPeerId: null,
  owedShares: [],
};
let n = 0;
const tx = (over: Partial<ReconcileTx> & Pick<ReconcileTx, "type" | "amountCents">): ReconcileTx => ({
  ...base,
  id: `t${++n}`,
  date: new Date("2026-10-05T00:00:00Z"),
  ...over,
});

describe("money in and out of an account", () => {
  it("takes out what an expense actually paid, owed shares included", () => {
    expect(moneyIntoAccount(tx({ type: "EXPENSE", amountCents: 3_000, owedShares: [{ amountCents: 2_000 }] }), "chq")).toBe(-5_000);
    expect(moneyIntoAccount(tx({ type: "EXPENSE", amountCents: -800 }), "chq")).toBe(800); // a refund
    expect(moneyIntoAccount(tx({ type: "INCOME", amountCents: 100_000 }), "chq")).toBe(100_000);
  });

  it("counts a transfer once on each side", () => {
    const unpaired = tx({ type: "TRANSFER", amountCents: 50_000, transferAccountId: "visa" });
    expect(moneyIntoAccount(unpaired, "chq")).toBe(-50_000);
    expect(moneyIntoAccount(unpaired, "visa")).toBe(50_000);
    // Paired: the card has its own arriving leg, so the chequing leg is not counted there.
    const paired = tx({ type: "TRANSFER", amountCents: 50_000, transferAccountId: "visa", transferPeerId: "leg2" });
    expect(moneyIntoAccount(paired, "visa")).toBeNull();
    const arriving = tx({ type: "TRANSFER", amountCents: -50_000, accountId: "visa", transferAccountId: "chq", transferPeerId: "x" });
    expect(moneyIntoAccount(arriving, "visa")).toBe(50_000);
  });

  it("ignores entries on other accounts", () => {
    expect(moneyIntoAccount(tx({ type: "EXPENSE", amountCents: 1, accountId: "other" }), "chq")).toBeNull();
  });
});

describe("reconciling a statement", () => {
  it("arrives at the closing balance of a chequing account", () => {
    const result = reconcile({
      accountId: "chq",
      liability: false,
      openingCents: 100_000,
      closingCents: 175_000,
      transactions: [
        tx({ type: "EXPENSE", amountCents: 25_000, date: new Date("2026-10-03T00:00:00Z") }),
        tx({ type: "INCOME", amountCents: 100_000, date: new Date("2026-10-01T00:00:00Z") }),
      ],
    });
    expect(result).toMatchObject({ moneyInCents: 100_000, moneyOutCents: 25_000, expectedClosingCents: 175_000, differenceCents: 0 });
    expect(result.rows.map((r) => r.balanceCents)).toEqual([200_000, 175_000]);
  });

  it("treats a card's balance as what is owed", () => {
    const result = reconcile({
      accountId: "visa",
      liability: true,
      openingCents: 40_000,
      closingCents: 15_000,
      transactions: [
        tx({ type: "EXPENSE", amountCents: 25_000, accountId: "visa" }),
        tx({ type: "TRANSFER", amountCents: 50_000, accountId: "chq", transferAccountId: "visa" }),
      ],
    });
    expect(result.expectedClosingCents).toBe(15_000);
    expect(result.differenceCents).toBe(0);
  });

  it("says how far off a statement is", () => {
    const result = reconcile({
      accountId: "chq",
      liability: false,
      openingCents: 0,
      closingCents: -1_250,
      transactions: [tx({ type: "EXPENSE", amountCents: 1_000 })],
    });
    expect(result.differenceCents).toBe(-250);
  });
});

describe("balance input", () => {
  it("reads amounts people type, zero and negatives included", () => {
    expect(parseBalanceInput("1,234.56")).toBe(123_456);
    expect(parseBalanceInput("$0")).toBe(0);
    expect(parseBalanceInput("-12.5")).toBe(-1_250);
    expect(parseBalanceInput("abc")).toBeNull();
    expect(parseBalanceInput("")).toBeNull();
  });
});
