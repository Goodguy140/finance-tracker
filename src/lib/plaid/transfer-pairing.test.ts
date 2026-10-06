import { describe, expect, it } from "vitest";
import {
  assignTransferPairs,
  transferPairDateDelta,
  widenDateFilterForPairing,
  type PairableStaged,
} from "@/lib/plaid/transfer-pairing";

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function row(overrides: Partial<PairableStaged> & { id: string }): PairableStaged {
  return {
    accountId: "chequing",
    type: "TRANSFER",
    amountCents: 50000,
    date: d("2026-09-30"),
    postedDate: null,
    ...overrides,
  };
}

// A card payment as both banks report it: out of chequing, into the card.
const paymentOut = row({ id: "out", accountId: "chequing", amountCents: 50000 });
const paymentIn = row({ id: "in", accountId: "visa", amountCents: -50000, date: d("2026-10-01") });

describe("transferPairDateDelta", () => {
  it("pairs money leaving one account with the same amount arriving in another", () => {
    expect(transferPairDateDelta(paymentOut, paymentIn)).toBe(1);
    expect(transferPairDateDelta(paymentIn, paymentOut)).toBe(1);
  });

  it("compares income by the money it brings in", () => {
    // The savings side filed as income, staged positive.
    const deposit = row({ id: "dep", accountId: "savings", type: "INCOME", amountCents: 50000 });
    expect(transferPairDateDelta(paymentOut, deposit)).toBe(0);
  });

  it("refuses the same direction, a different amount, the same account, or an unmapped one", () => {
    expect(transferPairDateDelta(paymentOut, { ...paymentIn, amountCents: 50000 })).toBeNull();
    expect(transferPairDateDelta(paymentOut, { ...paymentIn, amountCents: -49999 })).toBeNull();
    expect(transferPairDateDelta(paymentOut, { ...paymentIn, accountId: "chequing" })).toBeNull();
    expect(transferPairDateDelta(paymentOut, { ...paymentIn, accountId: null })).toBeNull();
    expect(transferPairDateDelta(paymentOut, paymentOut)).toBeNull();
  });

  it("refuses rows further apart than a few days", () => {
    expect(transferPairDateDelta(paymentOut, { ...paymentIn, date: d("2026-10-04") })).toBe(4);
    expect(transferPairDateDelta(paymentOut, { ...paymentIn, date: d("2026-10-05") })).toBeNull();
  });

  it("needs the sync to have taken at least one side for a transfer", () => {
    const purchase = row({ id: "p", accountId: "visa", type: "EXPENSE", amountCents: 5000 });
    const refundElsewhere = row({ id: "r", accountId: "chequing", type: "EXPENSE", amountCents: -5000 });
    expect(transferPairDateDelta(purchase, refundElsewhere)).toBeNull();
    expect(transferPairDateDelta({ ...purchase, type: "TRANSFER" }, refundElsewhere)).toBe(0);
  });
});

describe("assignTransferPairs", () => {
  it("returns each pair both ways round", () => {
    const pairs = assignTransferPairs([paymentOut, paymentIn]);
    expect(pairs.get("out")).toBe("in");
    expect(pairs.get("in")).toBe("out");
  });

  it("gives each row one partner, closest dates first", () => {
    // Two $500 moves to savings a week apart, each arriving the next day.
    const rows = [
      row({ id: "a-out", accountId: "chequing", date: d("2026-09-01") }),
      row({ id: "b-out", accountId: "chequing", date: d("2026-09-04") }),
      row({ id: "a-in", accountId: "savings", amountCents: -50000, date: d("2026-09-02") }),
      row({ id: "b-in", accountId: "savings", amountCents: -50000, date: d("2026-09-05") }),
    ];
    const pairs = assignTransferPairs(rows);
    expect(pairs.get("a-out")).toBe("a-in");
    expect(pairs.get("b-out")).toBe("b-in");
    // Order of input does not change the answer.
    expect(assignTransferPairs([...rows].reverse())).toEqual(pairs);
  });

  it("leaves a row with no counterpart unpaired", () => {
    expect(assignTransferPairs([paymentOut]).size).toBe(0);
  });
});

describe("widenDateFilterForPairing", () => {
  it("pads a period by the pairing tolerance and leaves lifetime unfiltered", () => {
    const widened = widenDateFilterForPairing({ date: { gte: d("2026-10-01"), lt: d("2026-11-01") } });
    expect(widened).toEqual({ date: { gte: d("2026-09-27"), lt: d("2026-11-05") } });
    expect(widenDateFilterForPairing({})).toEqual({});
  });
});
