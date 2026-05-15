import { describe, expect, it } from "vitest";
import {
  buildExpenseTitleSuggestions,
  categoryIdForExpenseTitle,
  expenseLogMatchesQuery,
} from "@/lib/expense-title-suggestions";

describe("buildExpenseTitleSuggestions", () => {
  it("keeps the newest category per normalized title", () => {
    const suggestions = buildExpenseTitleSuggestions([
      { title: "  Groceries ", categoryId: "cat-new" },
      { title: "groceries", categoryId: "cat-old" },
      { title: "Fuel", categoryId: "cat-fuel" },
    ]);
    expect(suggestions).toEqual([
      { title: "Groceries", categoryId: "cat-new" },
      { title: "Fuel", categoryId: "cat-fuel" },
    ]);
  });
});

describe("categoryIdForExpenseTitle", () => {
  const suggestions = buildExpenseTitleSuggestions([
    { title: "Shell fuel", categoryId: "transport" },
  ]);

  it("matches case-insensitively", () => {
    expect(categoryIdForExpenseTitle(suggestions, "  shell fuel ")).toBe("transport");
  });

  it("returns undefined when unknown", () => {
    expect(categoryIdForExpenseTitle(suggestions, "Coffee")).toBeUndefined();
  });
});

describe("expenseLogMatchesQuery", () => {
  const format = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  it("matches title, category, and amount fragments", () => {
    const entry = {
      title: "Weekly groceries",
      note: "Costco run",
      categoryLabel: "Food",
      accountLabel: "Visa",
      amountCents: 4523,
    };
    expect(expenseLogMatchesQuery(entry, "", format)).toBe(true);
    expect(expenseLogMatchesQuery(entry, "groceries", format)).toBe(true);
    expect(expenseLogMatchesQuery(entry, "food", format)).toBe(true);
    expect(expenseLogMatchesQuery(entry, "45.23", format)).toBe(true);
    expect(expenseLogMatchesQuery(entry, "rent", format)).toBe(false);
  });
});
