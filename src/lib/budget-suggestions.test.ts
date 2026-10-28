import { describe, expect, it } from "vitest";
import { roundBudgetCents, suggestBudgets, suggestionMonths } from "./budget-suggestions";

type Tx = Parameters<typeof suggestBudgets>[0]["txs"][number];

function tx(ymd: string, cents: number, categoryId: string, type: "EXPENSE" | "INCOME" = "EXPENSE", splits: Tx["splits"] = []): Tx {
  return { type, amountCents: cents, date: new Date(`${ymd}T00:00:00Z`), categoryId, categoryName: categoryId, splits };
}

const categories = [
  { id: "food", name: "Food" },
  { id: "fun", name: "Fun" },
  { id: "gifts", name: "Gifts" },
  { id: "home", name: "Home" },
];
const months = ["2026-07", "2026-08", "2026-09"];

describe("suggestBudgets", () => {
  const set = suggestBudgets({
    window: 3,
    months,
    categories,
    currentLimits: new Map([["fun", 50_00]]),
    txs: [
      tx("2026-06-30", 99_999_00, "food"), // before the window
      tx("2026-07-04", 400_00, "food"),
      tx("2026-08-09", 1_900_00, "food"), // a one-off month
      tx("2026-09-12", 432_00, "food"),
      tx("2026-09-20", -12_00, "food"), // a refund nets off
      tx("2026-07-01", 30_00, "fun"),
      tx("2026-08-01", 30_00, "fun"),
      tx("2026-09-01", 30_00, "fun"),
      tx("2026-09-14", 300_00, "gifts"), // one month in three: no typical spend
      tx("2026-08-15", 120_00, "costco", "EXPENSE", [
        { categoryId: "home", categoryName: "Home", amountCents: 80_00 },
        { categoryId: "food", categoryName: "Food", amountCents: 40_00 },
      ]),
      tx("2026-07-15", 80_00, "home"),
      tx("2026-09-15", 80_00, "home"),
      tx("2026-07-30", 3_000_00, "salary", "INCOME"),
      tx("2026-08-30", 3_300_00, "salary", "INCOME"),
      tx("2026-10-01", 9_999_00, "salary", "INCOME"), // after the window
    ],
  });

  it("takes the median month, so one large month passes over, and rounds it up", () => {
    const food = set.rows.find((r) => r.categoryId === "food")!;
    expect(food.monthlyCents).toEqual([400_00, 1_940_00, 420_00]);
    expect(food.typicalCents).toBe(420_00);
    expect(food.suggestedCents).toBe(420_00);
    expect(food.spikeMonths).toEqual(["2026-08"]);
  });

  it("counts split parts toward their own categories", () => {
    expect(set.rows.find((r) => r.categoryId === "home")?.monthlyCents).toEqual([80_00, 80_00, 80_00]);
  });

  it("skips a category spent on in only one month, and shows the budget already set", () => {
    expect(set.rows.map((r) => r.categoryId)).toEqual(["food", "home", "fun"]);
    expect(set.rows.find((r) => r.categoryId === "fun")?.currentLimitCents).toBe(50_00);
    expect(set.rows.find((r) => r.categoryId === "food")?.currentLimitCents).toBeNull();
  });

  it("averages income over the same months", () => {
    expect(set.averageIncomeCents).toBe(2_100_00);
  });
});

describe("suggestionMonths", () => {
  it("is the full months before this one, from the first transaction on", () => {
    expect(suggestionMonths("2026-02", 3, "2025-01")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(suggestionMonths("2026-02", 6, "2025-12")).toEqual(["2025-12", "2026-01"]);
    expect(suggestionMonths("2026-02", 3, "2026-02")).toEqual([]);
    expect(suggestionMonths("2026-02", 3, null)).toEqual([]);
  });
});

describe("roundBudgetCents", () => {
  it("rounds up to $5, $10 or $25 by size", () => {
    expect(roundBudgetCents(42_10)).toBe(45_00);
    expect(roundBudgetCents(100_00)).toBe(100_00);
    expect(roundBudgetCents(431_00)).toBe(440_00);
    expect(roundBudgetCents(1_201_00)).toBe(1_225_00);
    expect(roundBudgetCents(-5_00)).toBe(0);
  });
});
