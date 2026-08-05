import { describe, expect, it } from "vitest";
import {
  type GroupableExpenseEntry,
  expenseLogGroupKey,
  groupExpenseLogEntries,
  summarizeExpenseGroup,
} from "@/lib/expense-log-grouping";

function entry(overrides: Partial<GroupableExpenseEntry> & { id: string }): GroupableExpenseEntry {
  return {
    title: "Groceries",
    dateYmd: "2026-08-03",
    accountId: "acct-visa",
    accountLabel: "Visa (Credit card)",
    amountCents: 1000,
    preCreditCents: null,
    creditCents: null,
    categoryLabel: "Food",
    isSplit: false,
    ...overrides,
  };
}

describe("expenseLogGroupKey", () => {
  it("normalizes title case and whitespace", () => {
    expect(expenseLogGroupKey(entry({ id: "a", title: "  GROCERIES " }))).toBe(
      expenseLogGroupKey(entry({ id: "b", title: "groceries" })),
    );
  });

  it("returns null for blank or missing titles", () => {
    expect(expenseLogGroupKey(entry({ id: "a", title: null }))).toBeNull();
    expect(expenseLogGroupKey(entry({ id: "b", title: "   " }))).toBeNull();
  });

  it("falls back to the account label when the account was removed", () => {
    const removedA = entry({ id: "a", accountId: null, accountLabel: "Old Visa" });
    const removedB = entry({ id: "b", accountId: null, accountLabel: "Old Amex" });
    expect(expenseLogGroupKey(removedA)).not.toBe(expenseLogGroupKey(removedB));
  });
});

describe("groupExpenseLogEntries", () => {
  it("merges entries sharing date, title, and account", () => {
    const groups = groupExpenseLogEntries([
      entry({ id: "a" }),
      entry({ id: "b", categoryLabel: "Household" }),
      entry({ id: "c", title: "groceries" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps entries apart when date, title, or account differs", () => {
    const groups = groupExpenseLogEntries([
      entry({ id: "a" }),
      entry({ id: "b", dateYmd: "2026-08-04" }),
      entry({ id: "c", title: "Fuel" }),
      entry({ id: "d", accountId: "acct-amex" }),
    ]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("never merges untitled entries, even on the same date and account", () => {
    const groups = groupExpenseLogEntries([
      entry({ id: "a", title: null }),
      entry({ id: "b", title: null }),
      entry({ id: "c", title: "" }),
    ]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it("places each group where its first member appeared", () => {
    const groups = groupExpenseLogEntries([
      entry({ id: "a", title: "Fuel" }),
      entry({ id: "b" }),
      entry({ id: "c", title: "Fuel" }),
      entry({ id: "d" }),
    ]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([
      ["a", "c"],
      ["b", "d"],
    ]);
  });

  it("returns an empty list for no entries", () => {
    expect(groupExpenseLogEntries([])).toEqual([]);
  });
});

describe("summarizeExpenseGroup", () => {
  it("sums amounts and collects unique categories in order", () => {
    const summary = summarizeExpenseGroup([
      entry({ id: "a", amountCents: 5210, categoryLabel: "Food" }),
      entry({ id: "b", amountCents: 6000, categoryLabel: "Household" }),
      entry({ id: "c", amountCents: 3050, categoryLabel: "Food" }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.amountCents).toBe(14260);
    expect(summary.categoryLabels).toEqual(["Food", "Household"]);
    expect(summary.preCreditCents).toBeNull();
    expect(summary.creditCents).toBe(0);
    expect(summary.anySplit).toBe(false);
  });

  it("handles negative amounts (refunds) in the total", () => {
    const summary = summarizeExpenseGroup([
      entry({ id: "a", amountCents: 5000 }),
      entry({ id: "b", amountCents: -1500 }),
    ]);
    expect(summary.amountCents).toBe(3500);
  });

  it("sums receipt totals and credits, filling in plain amounts", () => {
    const summary = summarizeExpenseGroup([
      entry({ id: "a", amountCents: 900, preCreditCents: 1000, creditCents: 100 }),
      entry({ id: "b", amountCents: 2500 }),
    ]);
    expect(summary.preCreditCents).toBe(3500);
    expect(summary.creditCents).toBe(100);
  });

  it("flags groups containing a split transaction", () => {
    const summary = summarizeExpenseGroup([
      entry({ id: "a" }),
      entry({ id: "b", isSplit: true }),
    ]);
    expect(summary.anySplit).toBe(true);
  });
});
