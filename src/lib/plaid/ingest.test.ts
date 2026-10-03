import { TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ymdFromDateUtc } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { mapPlaidAmount, normalizePlaidTransaction, resolveDisplayName } from "@/lib/plaid/ingest";
import type { PlaidApiTransaction } from "@/lib/plaid/types";

function txn(overrides: Partial<PlaidApiTransaction> = {}): PlaidApiTransaction {
  return {
    transaction_id: "txn-1",
    account_id: "acct-1",
    amount: 12.34,
    iso_currency_code: "CAD",
    date: "2026-09-10",
    name: "COFFEE SHOP",
    pending: false,
    ...overrides,
  };
}

describe("mapPlaidAmount", () => {
  it("treats a positive amount as money out", () => {
    // Plaid's convention is the inverse of most people's intuition.
    expect(mapPlaidAmount({ amount: 12.34, pfcPrimary: "FOOD_AND_DRINK" })).toEqual({
      kind: "expense",
      type: TransactionType.EXPENSE,
      amountCents: 1234,
    });
  });

  it("treats negative INCOME as income, stored positive", () => {
    for (const primary of ["INCOME", "income", " income "]) {
      expect(mapPlaidAmount({ amount: -2500, pfcPrimary: primary })).toEqual({
        kind: "income",
        type: TransactionType.INCOME,
        amountCents: 250000,
      });
    }
  });

  it("books money moving between accounts as a transfer, keeping Plaid's sign", () => {
    // Paying a card from chequing used to stage an expense here and income on the card,
    // counting the purchases it paid off a second time.
    expect(mapPlaidAmount({ amount: 500, pfcPrimary: "TRANSFER_OUT" })).toEqual({
      kind: "transfer",
      type: TransactionType.TRANSFER,
      amountCents: 50000,
    });
    for (const primary of ["TRANSFER_IN", " transfer_in "]) {
      expect(mapPlaidAmount({ amount: -2500, pfcPrimary: primary })).toEqual({
        kind: "transfer",
        type: TransactionType.TRANSFER,
        amountCents: -250000,
      });
    }
  });

  it("books a credit-card payment as a transfer on either side, but not other loan payments", () => {
    const cardPayment = { pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" };
    expect(mapPlaidAmount({ amount: 300, ...cardPayment })).toMatchObject({
      type: TransactionType.TRANSFER,
      amountCents: 30000,
    });
    expect(mapPlaidAmount({ amount: -300, ...cardPayment })).toMatchObject({
      type: TransactionType.TRANSFER,
      amountCents: -30000,
    });
    // No loan accounts exist in this app, so a mortgage payment leaves everything it tracks.
    expect(
      mapPlaidAmount({ amount: 1800, pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }),
    ).toMatchObject({ type: TransactionType.EXPENSE, amountCents: 180000 });
  });

  it("books a merchant refund as a NEGATIVE expense, not as income", () => {
    // The subtlest rule in the feature. Booking a refund as income would inflate reported
    // income and leave the original spend uncorrected in its category, so budgets would
    // stay wrong. A negative expense reverses the spend where it happened.
    expect(mapPlaidAmount({ amount: -45.9, pfcPrimary: "GENERAL_MERCHANDISE" })).toEqual({
      kind: "expense",
      type: TransactionType.EXPENSE,
      amountCents: -4590,
    });
  });

  it("treats a negative amount with no category as a refund rather than guessing income", () => {
    expect(mapPlaidAmount({ amount: -10, pfcPrimary: null })).toMatchObject({
      type: TransactionType.EXPENSE,
      amountCents: -1000,
    });
    expect(mapPlaidAmount({ amount: -10, pfcPrimary: undefined })).toMatchObject({
      type: TransactionType.EXPENSE,
      amountCents: -1000,
    });
  });

  it("skips zero-amount authorisation holds", () => {
    expect(mapPlaidAmount({ amount: 0, pfcPrimary: "FOOD_AND_DRINK" })).toEqual({
      kind: "skip",
      reason: "zero",
    });
  });

  it("skips non-finite amounts rather than writing NaN", () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(mapPlaidAmount({ amount, pfcPrimary: null })).toEqual({ kind: "skip", reason: "zero" });
    }
  });

  it("skips amounts past the 32-bit money column bound, in both directions", () => {
    // Every money column is a signed 32-bit Int; exceeding it is a raw database error.
    const tooBig = MAX_AMOUNT_CENTS / 100 + 1;
    expect(mapPlaidAmount({ amount: tooBig, pfcPrimary: null })).toEqual({
      kind: "skip",
      reason: "out_of_range",
    });
    expect(mapPlaidAmount({ amount: -tooBig, pfcPrimary: "INCOME" })).toEqual({
      kind: "skip",
      reason: "out_of_range",
    });
  });

  it("accepts an amount exactly at the bound", () => {
    expect(mapPlaidAmount({ amount: MAX_AMOUNT_CENTS / 100, pfcPrimary: null })).toMatchObject({
      kind: "expense",
      amountCents: MAX_AMOUNT_CENTS,
    });
  });

  it("rounds fractional cents rather than truncating", () => {
    expect(mapPlaidAmount({ amount: 0.005, pfcPrimary: null })).toMatchObject({ amountCents: 1 });
    expect(mapPlaidAmount({ amount: 10.999, pfcPrimary: null })).toMatchObject({ amountCents: 1100 });
  });
});

describe("normalizePlaidTransaction", () => {
  it("stores the date as UTC midnight, matching every other calendar date", () => {
    const result = normalizePlaidTransaction(txn({ date: "2026-09-10" }), { cutoff: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ymdFromDateUtc(result.value.date)).toBe("2026-09-10");
    expect(result.value.date.getUTCHours()).toBe(0);
  });

  it("keeps authorized_date as the posted date when present", () => {
    const result = normalizePlaidTransaction(
      txn({ date: "2026-09-12", authorized_date: "2026-09-10" }),
      { cutoff: null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ymdFromDateUtc(result.value.postedDate!)).toBe("2026-09-10");
  });

  it("drops rows older than the chosen history window", () => {
    // /transactions/sync takes no date parameters, so the window can only be applied here.
    const cutoff = new Date(Date.UTC(2026, 8, 1));
    expect(normalizePlaidTransaction(txn({ date: "2026-08-31" }), { cutoff })).toEqual({
      ok: false,
      reason: "before_cutoff",
    });
  });

  it("keeps a transaction dated exactly on the cutoff", () => {
    const cutoff = new Date(Date.UTC(2026, 8, 1));
    expect(normalizePlaidTransaction(txn({ date: "2026-09-01" }), { cutoff }).ok).toBe(true);
  });

  it("carries the pending linkage through untouched", () => {
    const result = normalizePlaidTransaction(
      txn({ pending: true, pending_transaction_id: "pending-abc" }),
      { cutoff: null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isPending).toBe(true);
    expect(result.value.pendingPlaidTransactionId).toBe("pending-abc");
  });

  it("records currency without acting on it, falling back to the unofficial code", () => {
    const iso = normalizePlaidTransaction(txn({ iso_currency_code: "USD" }), { cutoff: null });
    expect(iso.ok && iso.value.currency).toBe("USD");

    const unofficial = normalizePlaidTransaction(
      txn({ iso_currency_code: null, unofficial_currency_code: "BTC" }),
      { cutoff: null },
    );
    expect(unofficial.ok && unofficial.value.currency).toBe("BTC");

    const neither = normalizePlaidTransaction(
      txn({ iso_currency_code: null, unofficial_currency_code: null }),
      { cutoff: null },
    );
    expect(neither.ok && neither.value.currency).toBeNull();
  });

  it("carries the Plaid category through for the suggestion step", () => {
    const result = normalizePlaidTransaction(
      txn({
        personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
      }),
      { cutoff: null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pfcPrimary).toBe("FOOD_AND_DRINK");
    expect(result.value.pfcDetailed).toBe("FOOD_AND_DRINK_COFFEE");
  });

  it("rejects rows missing the fields everything else depends on", () => {
    expect(normalizePlaidTransaction(txn({ transaction_id: "" }), { cutoff: null })).toEqual({
      ok: false,
      reason: "unusable",
    });
    expect(normalizePlaidTransaction(txn({ account_id: "" }), { cutoff: null })).toEqual({
      ok: false,
      reason: "unusable",
    });
    expect(
      normalizePlaidTransaction({ ...txn(), date: undefined as unknown as string }, { cutoff: null }),
    ).toEqual({ ok: false, reason: "unusable" });
  });

  it("surfaces the amount skip reasons rather than swallowing the row silently", () => {
    expect(normalizePlaidTransaction(txn({ amount: 0 }), { cutoff: null })).toEqual({
      ok: false,
      reason: "zero",
    });
    expect(
      normalizePlaidTransaction(txn({ amount: MAX_AMOUNT_CENTS }), { cutoff: null }),
    ).toEqual({ ok: false, reason: "out_of_range" });
  });

  it("applies the window before the amount checks, so an old $0 row reads as out of window", () => {
    // Ordering matters only for which reason is reported, but the reasons drive the
    // "N skipped" summary the user sees, so they should be the honest one.
    const cutoff = new Date(Date.UTC(2026, 8, 1));
    expect(normalizePlaidTransaction(txn({ date: "2026-01-01", amount: 0 }), { cutoff })).toEqual({
      ok: false,
      reason: "before_cutoff",
    });
  });
});

describe("resolveDisplayName", () => {
  it("uses Plaid's merchant name as sent when it has one", () => {
    expect(resolveDisplayName("SQ *BLUE BOTTLE #412 TORONTO ON", "Blue Bottle Coffee")).toBe(
      "Blue Bottle Coffee",
    );
  });

  it("cleans up the bank description when there is no merchant name", () => {
    expect(resolveDisplayName("SQ *BLUE BOTTLE #412 TORONTO ON", null)).toBe("Blue Bottle Toronto");
    expect(resolveDisplayName("POS PURCHASE INTERAC LOBLAWS", null)).toBe("Loblaws");
    expect(resolveDisplayName("TST* THE LOCAL PUB", undefined)).toBe("The Local Pub");
  });

  it("treats a blank merchant name as absent", () => {
    expect(resolveDisplayName("POS PURCHASE INTERAC LOBLAWS", "   ")).toBe("Loblaws");
  });

  it("keeps the raw description when cleanup would leave nothing", () => {
    // Better an odd title than a blank one; the user can rename it either way.
    expect(resolveDisplayName("#### ****", null)).toBe("#### ****");
    expect(resolveDisplayName("  ", null)).toBe("");
  });
});
