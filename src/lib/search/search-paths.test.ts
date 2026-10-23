import { describe, expect, it } from "vitest";
import { formatHitAmount } from "./format";
import { parseAmountQuery, parseSearchTransactionType, searchPageHref, transactionHref } from "./search-paths";

describe("parseAmountQuery", () => {
  it("reads plain amounts as cents", () => {
    expect(parseAmountQuery("12.5")).toBe(1250);
    expect(parseAmountQuery("$1,200")).toBe(120000);
    expect(parseAmountQuery("-40")).toBe(4000);
    expect(parseAmountQuery(" 49.99 ")).toBe(4999);
  });

  it("leaves text that merely contains digits as text", () => {
    expect(parseAmountQuery("7-eleven")).toBeNull();
    expect(parseAmountQuery("1.234")).toBeNull();
    expect(parseAmountQuery("0")).toBeNull();
    expect(parseAmountQuery("coffee")).toBeNull();
  });
});

describe("transactionHref", () => {
  it("opens the dashboard on the transaction's own month, by its UTC date", () => {
    expect(transactionHref("abc", new Date("2025-02-28T00:00:00Z"))).toBe("/?month=2025-02&open=abc");
  });
});

describe("searchPageHref", () => {
  it("carries only the filters that are set", () => {
    expect(searchPageHref({})).toBe("/search");
    expect(searchPageHref({ query: " coffee ", tagId: "t1", type: "EXPENSE" })).toBe("/search?q=coffee&tag=t1&type=EXPENSE");
  });
});

describe("parseSearchTransactionType", () => {
  it("accepts the three types and nothing else", () => {
    expect(parseSearchTransactionType("TRANSFER")).toBe("TRANSFER");
    expect(parseSearchTransactionType("expense")).toBeUndefined();
  });
});

describe("formatHitAmount", () => {
  it("signs expenses as money out, refunds and income as money in, transfers not at all", () => {
    expect(formatHitAmount({ amountCents: 1250, currency: "CAD", type: "EXPENSE" })).toBe("−$12.50");
    expect(formatHitAmount({ amountCents: -1250, currency: "CAD", type: "EXPENSE" })).toBe("+$12.50");
    expect(formatHitAmount({ amountCents: 300000, currency: "CAD", type: "INCOME" })).toBe("+$3,000.00");
    expect(formatHitAmount({ amountCents: -5000, currency: "CAD", type: "TRANSFER" })).toBe("$50.00");
    expect(formatHitAmount({})).toBeNull();
  });
});
