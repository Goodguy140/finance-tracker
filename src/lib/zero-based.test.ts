import { describe, expect, it } from "vitest";
import { computeZeroBased, type ZeroBasedInput } from "./zero-based";

const base: ZeroBasedInput = {
  todayYmd: "2026-10-15",
  incomeReceivedCents: 300_000,
  spentCents: 70_000,
  occurrences: [
    { type: "INCOME", amountCents: 200_000, categoryId: "pay", dateYmd: "2026-10-30" },
    { type: "INCOME", amountCents: 200_000, categoryId: "pay", dateYmd: "2026-11-13" },
    { type: "EXPENSE", amountCents: 15_000, categoryId: "phone", dateYmd: "2026-10-20" },
    { type: "EXPENSE", amountCents: 50_000, categoryId: "food", dateYmd: "2026-10-25" },
  ],
  budgets: [
    { categoryId: "food", categoryName: "Food", limitCents: 60_000, baseLimitCents: 60_000, spentCents: 40_000 },
    // 20,000 carried in from September: not new money assigned this month.
    { categoryId: "fun", categoryName: "Fun", limitCents: 30_000, baseLimitCents: 10_000, spentCents: 25_000 },
  ],
  goalContributionsCents: [25_000],
};

describe("computeZeroBased", () => {
  it("subtracts assigned budgets, unbudgeted bills and spending, and goals from this month's income", () => {
    const z = computeZeroBased(base);
    expect(z.incomeCents).toBe(500_000); // received + October pay; November's is left out
    expect(z.assignedCents).toBe(70_000); // base limits, not the rollover carry
    expect(z.billsOutsideBudgetsCents).toBe(15_000); // the food bill sits inside its budget
    expect(z.spentOutsideBudgetsCents).toBe(5_000); // 70,000 spent − 65,000 inside budgets
    expect(z.goalsCents).toBe(25_000);
    expect(z.toAssignCents).toBe(500_000 - 70_000 - 15_000 - 5_000 - 25_000);
    expect(z.overspent).toEqual([]);
  });

  it("goes negative when more is assigned than came in, and lists overspent budgets to cover", () => {
    const z = computeZeroBased({
      ...base,
      incomeReceivedCents: 0,
      occurrences: [],
      spentCents: 130_000,
      budgets: [
        { categoryId: "food", categoryName: "Food", limitCents: 60_000, spentCents: 90_000 },
        { categoryId: "fun", categoryName: "Fun", limitCents: 30_000, baseLimitCents: 10_000, spentCents: 40_000 },
      ],
      goalContributionsCents: [],
    });
    expect(z.toAssignCents).toBe(-70_000);
    expect(z.overspent).toEqual([
      { categoryId: "food", categoryName: "Food", overCents: 30_000 },
      { categoryId: "fun", categoryName: "Fun", overCents: 10_000 },
    ]);
    expect(z.overspentCents).toBe(40_000);
  });
});
