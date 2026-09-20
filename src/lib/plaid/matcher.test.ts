import { TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  amountToleranceCents,
  assignMatches,
  bestDateDelta,
  merchantSimilarity,
  normalizeMerchant,
  scoreMatch,
  type MatchCandidate,
  type StagedForMatch,
} from "@/lib/plaid/matcher";

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function staged(overrides: Partial<StagedForMatch> = {}): StagedForMatch {
  return {
    id: "staged-1",
    accountId: "acct-1",
    type: TransactionType.EXPENSE,
    amountCents: 8421,
    date: d("2026-09-14"),
    postedDate: null,
    name: "SQ *BLUE BOTTLE #412 TORONTO ON",
    merchantName: "Blue Bottle Coffee",
    ...overrides,
  };
}

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id: "txn-1",
    accountId: "acct-1",
    type: TransactionType.EXPENSE,
    amountCents: 8421,
    date: d("2026-09-14"),
    postedDate: null,
    title: "Blue Bottle Coffee",
    isVerified: false,
    isSplitParent: false,
    ...overrides,
  };
}

describe("normalizeMerchant", () => {
  it("strips processor prefixes, store numbers and location tails", () => {
    expect(normalizeMerchant("SQ *BLUE BOTTLE #412 TORONTO ON")).toBe("blue bottle toronto");
    expect(normalizeMerchant("TST* THE LOCAL PUB")).toBe("the local pub");
    expect(normalizeMerchant("AMZN MKTP CA*2X4TR")).toBe("ca");
  });

  it("strips network and channel noise", () => {
    expect(normalizeMerchant("POS PURCHASE INTERAC LOBLAWS")).toBe("loblaws");
    expect(normalizeMerchant("VISA DEBIT PAYMENT SHELL")).toBe("shell");
  });

  it("is stable regardless of case and punctuation", () => {
    expect(normalizeMerchant("Blue-Bottle, Coffee.")).toBe(normalizeMerchant("BLUE BOTTLE COFFEE"));
  });

  it("handles empty and missing input without throwing", () => {
    expect(normalizeMerchant(null)).toBe("");
    expect(normalizeMerchant(undefined)).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
    expect(normalizeMerchant("#### ****")).toBe("");
  });
});

describe("merchantSimilarity", () => {
  it("scores an identical merchant at 1", () => {
    expect(merchantSimilarity("Netflix", "netflix")).toBe(1);
  });

  it("scores a noisy bank description against a clean title highly", () => {
    expect(merchantSimilarity("SQ *BLUE BOTTLE #412 TORONTO ON", "Blue Bottle")).toBeGreaterThan(0.5);
  });

  it("is length tolerant, where edit distance would not be", () => {
    expect(merchantSimilarity("NETFLIX.COM 866-579-7172", "Netflix")).toBeGreaterThan(0.4);
  });

  it("scores unrelated merchants low", () => {
    expect(merchantSimilarity("Loblaws", "Shell Fuel")).toBeLessThan(0.3);
  });

  it("returns 0 rather than throwing on empty input", () => {
    expect(merchantSimilarity("", "Netflix")).toBe(0);
    expect(merchantSimilarity("Netflix", "")).toBe(0);
  });
});

describe("bestDateDelta", () => {
  it("uses the closest pairing of transaction and posted dates", () => {
    // Bought Saturday, posted Monday: the user dated it Saturday, the bank Monday.
    const s = staged({ date: d("2026-09-14"), postedDate: d("2026-09-16") });
    const c = candidate({ date: d("2026-09-14"), postedDate: null });
    expect(bestDateDelta(s, c)).toBe(0);
  });

  it("falls back to the plain date gap when no posted dates exist", () => {
    expect(bestDateDelta(staged({ date: d("2026-09-10") }), candidate({ date: d("2026-09-13") }))).toBe(3);
  });
});

describe("amountToleranceCents", () => {
  it("uses a floor of one dollar for small amounts", () => {
    expect(amountToleranceCents(500)).toBe(100);
  });

  it("scales to 2% for larger amounts", () => {
    expect(amountToleranceCents(10_000)).toBe(200);
  });

  it("is symmetric for negative amounts", () => {
    expect(amountToleranceCents(-10_000)).toBe(200);
  });
});

describe("scoreMatch gates", () => {
  it("never matches a transaction already linked to another bank record", () => {
    // A hard exclusion, not a penalty: one bank record backs at most one transaction.
    expect(scoreMatch(staged(), candidate({ isVerified: true }))).toBeNull();
  });

  it("never matches across transaction types", () => {
    expect(scoreMatch(staged(), candidate({ type: TransactionType.INCOME }))).toBeNull();
  });

  it("never matches across different known accounts", () => {
    expect(scoreMatch(staged(), candidate({ accountId: "acct-other" }))).toBeNull();
  });

  it("still considers a candidate whose account was removed", () => {
    expect(scoreMatch(staged(), candidate({ accountId: null }))).not.toBeNull();
  });

  it("considers a staged row whose Plaid account is not mapped yet", () => {
    expect(scoreMatch(staged({ accountId: null }), candidate())).not.toBeNull();
  });

  it("refuses amounts beyond tolerance", () => {
    expect(scoreMatch(staged({ amountCents: 8421 }), candidate({ amountCents: 9999 }))).toBeNull();
  });

  it("refuses dates beyond tolerance", () => {
    expect(scoreMatch(staged(), candidate({ date: d("2026-09-25") }))).toBeNull();
  });

  it("never matches a refund against a purchase of the same size", () => {
    // Both are 84.21, but one is money in and one money out. Linking them would cancel
    // a real expense against a real refund and lose both.
    expect(scoreMatch(staged({ amountCents: -8421 }), candidate({ amountCents: 8421 }))).toBeNull();
    expect(scoreMatch(staged({ amountCents: 8421 }), candidate({ amountCents: -8421 }))).toBeNull();
  });

  it("does match a refund against the matching refund", () => {
    expect(
      scoreMatch(staged({ amountCents: -8421 }), candidate({ amountCents: -8421 })),
    ).not.toBeNull();
  });

  it("allows linking to a split parent", () => {
    // The verification sits on the parent; splits stay view-only as they already are.
    expect(scoreMatch(staged(), candidate({ isSplitParent: true }))).not.toBeNull();
  });
});

describe("scoreMatch tiers", () => {
  it("rates an exact same-day same-account match as high", () => {
    const result = scoreMatch(staged(), candidate());
    expect(result?.tier).toBe("high");
    expect(result?.reasons).toContain("exact amount");
    expect(result?.reasons).toContain("same account");
    expect(result?.reasons).toContain("same day");
  });

  it("keeps an approximate amount out of the high tier however well everything else fits", () => {
    // Small difference: rounding or a cash-back line, not a tip.
    const result = scoreMatch(staged({ amountCents: 8421 }), candidate({ amountCents: 8500 }));
    expect(result).not.toBeNull();
    expect(result?.tier).toBe("low");
    expect(result?.reasons.some((r) => r.startsWith("amount differs by"))).toBe(true);
  });

  it("matches a tipped restaurant bill, where the bank charged more than was recorded", () => {
    // The case the tolerance exists for: diner records the $47.00 meal, bank posts $54.20
    // including the tip. Far beyond any rounding band, so it needs the asymmetric one.
    const result = scoreMatch(staged({ amountCents: 5420 }), candidate({ amountCents: 4700 }));
    expect(result).not.toBeNull();
    expect(result?.tier).toBe("low");
    expect(result?.reasons.some((r) => r.includes("tip?"))).toBe(true);
    expect(result?.reasons.some((r) => r.includes("7.20"))).toBe(true);
  });

  it("does not accept the reverse: a bank amount lower than recorded is not a tip", () => {
    // A tip can only ever increase the charge. Allowing the other direction would pair
    // unrelated transactions for no gain.
    expect(scoreMatch(staged({ amountCents: 4700 }), candidate({ amountCents: 5420 }))).toBeNull();
  });

  it("refuses a difference too large to be a tip", () => {
    // 50% over is not a gratuity, it is a different transaction.
    expect(scoreMatch(staged({ amountCents: 7050 }), candidate({ amountCents: 4700 }))).toBeNull();
  });

  it("never applies the tip allowance to refunds", () => {
    // Both negative, 30% apart: plausible as a tip in magnitude, meaningless as a refund.
    expect(scoreMatch(staged({ amountCents: -6110 }), candidate({ amountCents: -4700 }))).toBeNull();
  });

  it("drops out of the high tier once the dates are more than two days apart", () => {
    expect(scoreMatch(staged(), candidate({ date: d("2026-09-16") }))?.tier).toBe("high");
    expect(scoreMatch(staged(), candidate({ date: d("2026-09-17") }))?.tier).toBe("low");
  });

  it("returns null rather than a weak suggestion below the low threshold", () => {
    // Different account on the candidate side is a gate, so weaken it legitimately:
    // unrelated merchant, four days apart, approximate amount.
    const result = scoreMatch(
      staged({ amountCents: 5000, merchantName: "Loblaws", name: "LOBLAWS" }),
      candidate({ amountCents: 5090, date: d("2026-09-18"), title: "Shell Fuel", accountId: null }),
    );
    expect(result).toBeNull();
  });

  it("scores deterministically for identical input", () => {
    const a = scoreMatch(staged(), candidate());
    const b = scoreMatch(staged(), candidate());
    expect(a).toEqual(b);
  });
});

describe("assignMatches", () => {
  it("never lets two staged rows claim the same transaction", () => {
    // Two identical $12.00 coffees on the same day, but only one was logged by hand.
    const rows = [
      staged({ id: "s1", amountCents: 1200, merchantName: "Coffee", name: "COFFEE" }),
      staged({ id: "s2", amountCents: 1200, merchantName: "Coffee", name: "COFFEE" }),
    ];
    const candidates = [candidate({ id: "t1", amountCents: 1200, title: "Coffee" })];

    const assigned = assignMatches(rows, candidates);
    expect(assigned.size).toBe(1);
    const claimed = [...assigned.values()].map((r) => r.transactionId);
    expect(new Set(claimed).size).toBe(1);
  });

  it("pairs two staged rows with two candidates one-to-one", () => {
    const rows = [
      staged({ id: "s1", amountCents: 1200, merchantName: "Coffee", name: "COFFEE" }),
      staged({ id: "s2", amountCents: 3400, merchantName: "Loblaws", name: "LOBLAWS" }),
    ];
    const candidates = [
      candidate({ id: "t1", amountCents: 1200, title: "Coffee" }),
      candidate({ id: "t2", amountCents: 3400, title: "Loblaws" }),
    ];
    const assigned = assignMatches(rows, candidates);
    expect(assigned.get("s1")?.transactionId).toBe("t1");
    expect(assigned.get("s2")?.transactionId).toBe("t2");
  });

  it("gives an ambiguous candidate to the stronger pairing", () => {
    const rows = [
      // Same day and exact amount: the stronger claim.
      staged({ id: "s1", amountCents: 1200, date: d("2026-09-14") }),
      // Three days out: weaker, and should yield.
      staged({ id: "s2", amountCents: 1200, date: d("2026-09-11") }),
    ];
    const candidates = [candidate({ id: "t1", amountCents: 1200, date: d("2026-09-14") })];
    const assigned = assignMatches(rows, candidates);
    expect(assigned.get("s1")?.transactionId).toBe("t1");
    expect(assigned.has("s2")).toBe(false);
  });

  it("is order independent", () => {
    // Shuffling the inputs must not change who gets matched, or suggestions would drift
    // between page loads for no reason the user could see.
    const rows = [
      staged({ id: "s1", amountCents: 1200, merchantName: "Coffee", name: "COFFEE" }),
      staged({ id: "s2", amountCents: 3400, merchantName: "Loblaws", name: "LOBLAWS" }),
    ];
    const candidates = [
      candidate({ id: "t1", amountCents: 1200, title: "Coffee" }),
      candidate({ id: "t2", amountCents: 3400, title: "Loblaws" }),
    ];
    const forward = assignMatches(rows, candidates);
    const reversed = assignMatches([...rows].reverse(), [...candidates].reverse());
    expect(forward.get("s1")?.transactionId).toBe(reversed.get("s1")?.transactionId);
    expect(forward.get("s2")?.transactionId).toBe(reversed.get("s2")?.transactionId);
  });

  it("breaks a genuine tie deterministically rather than arbitrarily", () => {
    const rows = [staged({ id: "s1", amountCents: 1200 })];
    const candidates = [
      candidate({ id: "t-b", amountCents: 1200, title: "Coffee" }),
      candidate({ id: "t-a", amountCents: 1200, title: "Coffee" }),
    ];
    const first = assignMatches(rows, candidates);
    const second = assignMatches(rows, [...candidates].reverse());
    // Lexicographically smallest id wins, so the choice is stable across orderings.
    expect(first.get("s1")?.transactionId).toBe("t-a");
    expect(second.get("s1")?.transactionId).toBe("t-a");
  });

  it("returns nothing when there is nothing plausible", () => {
    const assigned = assignMatches([staged()], [candidate({ isVerified: true })]);
    expect(assigned.size).toBe(0);
  });

  it("handles empty inputs", () => {
    expect(assignMatches([], []).size).toBe(0);
    expect(assignMatches([staged()], []).size).toBe(0);
    expect(assignMatches([], [candidate()]).size).toBe(0);
  });
});
