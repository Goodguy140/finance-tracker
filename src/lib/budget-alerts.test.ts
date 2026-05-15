import { describe, expect, it } from "vitest";
import {
  computeBudgetWarnings,
  computeMonthOverMonthTrends,
  computeOverBudgetTrends,
  dayOfMonthInYm,
  daysInMonthYm,
  daysLeftInMonthYm,
  formatBudgetWarningMessage,
  percentUsed,
} from "./budget-alerts";

const mayRef = new Date(Date.UTC(2025, 4, 15, 12, 0, 0, 0)); // 2025-05-15

describe("budget period helpers", () => {
  it("counts days in month and elapsed/remaining", () => {
    expect(daysInMonthYm("2025-05")).toBe(31);
    expect(dayOfMonthInYm(mayRef, "2025-05")).toBe(15);
    expect(daysLeftInMonthYm(mayRef, "2025-05")).toBe(16);
  });

  it("clamps day index outside month", () => {
    const before = new Date(Date.UTC(2025, 3, 30));
    expect(dayOfMonthInYm(before, "2025-05")).toBe(1);
    const after = new Date(Date.UTC(2025, 5, 2));
    expect(dayOfMonthInYm(after, "2025-05")).toBe(31);
  });
});

describe("computeBudgetWarnings", () => {
  const rows = [
    { categoryId: "c1", categoryName: "Dining", spentCents: 8200, limitCents: 10000 },
    { categoryId: "c2", categoryName: "Groceries", spentCents: 4000, limitCents: 10000 },
    { categoryId: "c3", categoryName: "Transit", spentCents: 11000, limitCents: 10000 },
  ];

  it("returns warning at 80% and critical at 100%", () => {
    const alerts = computeBudgetWarnings(rows, { ym: "2025-05", reference: mayRef });
    expect(alerts.map((a) => a.categoryName)).toEqual(["Transit", "Dining"]);
    expect(alerts.find((a) => a.categoryName === "Dining")?.severity).toBe("warning");
    expect(alerts.find((a) => a.categoryName === "Transit")?.severity).toBe("critical");
    expect(alerts.find((a) => a.categoryName === "Dining")?.daysLeft).toBe(16);
  });

  it("skips categories without a limit", () => {
    const alerts = computeBudgetWarnings(
      [{ categoryId: "x", categoryName: "Misc", spentCents: 5000, limitCents: 0 }],
      { ym: "2025-05", reference: mayRef },
    );
    expect(alerts).toHaveLength(0);
  });
});

describe("computeOverBudgetTrends", () => {
  it("flags categories ahead of linear pace", () => {
    // Mid-month (15/31): expected ~48% of budget; 70% spent => over pace
    const rows = [
      { categoryId: "c1", categoryName: "Dining", spentCents: 7000, limitCents: 10000 },
    ];
    const trends = computeOverBudgetTrends(rows, { ym: "2025-05", reference: mayRef });
    expect(trends).toHaveLength(1);
    expect(trends[0].paceRatio).toBeGreaterThan(1.05);
  });

  it("ignores categories on or under pace", () => {
    const rows = [
      { categoryId: "c1", categoryName: "Dining", spentCents: 2000, limitCents: 10000 },
    ];
    expect(computeOverBudgetTrends(rows, { ym: "2025-05", reference: mayRef })).toHaveLength(0);
  });
});

describe("computeMonthOverMonthTrends", () => {
  it("compares daily spend rate to prior month", () => {
    const prior = new Map([
      ["c1", { categoryId: "c1", spentCents: 3100, limitCents: 10000 }],
    ]);
    const rows = [
      { categoryId: "c1", categoryName: "Dining", spentCents: 5000, limitCents: 10000 },
    ];
    const trends = computeMonthOverMonthTrends(rows, prior, { ym: "2025-05", reference: mayRef });
    expect(trends.length).toBeGreaterThan(0);
  });
});

describe("formatBudgetWarningMessage", () => {
  it("formats user-facing warning copy", () => {
    expect(formatBudgetWarningMessage("Dining", 82, 12)).toBe(
      "Dining is 82% used with 12 days left.",
    );
    expect(percentUsed(8200, 10000)).toBe(82);
  });
});
