import { describe, expect, it } from "vitest";
import {
  computeBudgetWarnings,
  computeMonthOverMonthTrends,
  computeOverBudgetTrends,
  dayOfMonthInYm,
  daysInMonthYm,
  daysLeftInMonthYm,
  formatBudgetOverBudgetMessage,
  formatBudgetWarningMessage,
  percentUsed,
} from "./budget-alerts";
import { formatCurrency } from "./money";

const mayRef = new Date(Date.UTC(2025, 4, 15, 12, 0, 0, 0)); // 2025-05-15
const earlyMayRef = new Date(Date.UTC(2025, 4, 2, 12, 0, 0, 0)); // 2025-05-02 (day 2)

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

  it("does not alert a budget that is exactly at its limit", () => {
    const alerts = computeBudgetWarnings(
      [{ categoryId: "c1", categoryName: "Dining", spentCents: 10000, limitCents: 10000 }],
      { ym: "2025-05", reference: mayRef },
    );
    expect(alerts).toHaveLength(0);
  });

  it("treats one cent under the limit as a warning, not critical (no rounding false-positive)", () => {
    const alerts = computeBudgetWarnings(
      [{ categoryId: "c1", categoryName: "Dining", spentCents: 9999, limitCents: 10000 }],
      { ym: "2025-05", reference: mayRef },
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].percentUsed).toBe(100); // rounds to 100 but is under limit
  });

  it("marks strictly-over budgets critical and exposes remaining cents", () => {
    const alerts = computeBudgetWarnings(
      [{ categoryId: "c1", categoryName: "Dining", spentCents: 10300, limitCents: 10000 }],
      { ym: "2025-05", reference: mayRef },
    );
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].remainingCents).toBe(-300);
    expect(alerts[0].message).toBe(formatBudgetOverBudgetMessage("Dining", 300));
  });

  it("writes amounts in the user's home currency, not always dollars", () => {
    const rows = [
      { categoryId: "c1", categoryName: "Dining", spentCents: 1030000, limitCents: 1000000 },
      { categoryId: "c2", categoryName: "Fun", spentCents: 900000, limitCents: 1000000 },
    ];
    const alerts = computeBudgetWarnings(rows, { ym: "2025-05", reference: mayRef, currency: "JPY" });
    expect(alerts[0].message).toBe(`Dining is over budget by ${formatCurrency(30000, "JPY")}.`);
    expect(alerts[1].message).toContain(formatCurrency(100000, "JPY"));
    expect(alerts.map((a) => a.message).join(" ")).not.toContain("$");

    const pace = computeOverBudgetTrends(
      [{ categoryId: "c1", categoryName: "Dining", spentCents: 900000, limitCents: 1000000 }],
      { ym: "2025-05", reference: mayRef, currency: "JPY" },
    );
    expect(pace[0].message).toContain(formatCurrency(pace[0].projectedOverCents, "JPY"));
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

  it("ignores categories already over budget (covered by the critical warning)", () => {
    const rows = [
      { categoryId: "c1", categoryName: "Dining", spentCents: 12000, limitCents: 10000 },
    ];
    expect(computeOverBudgetTrends(rows, { ym: "2025-05", reference: mayRef })).toHaveLength(0);
  });

  it("stays quiet too early in the month for a projection to mean anything", () => {
    const rows = [
      { categoryId: "c1", categoryName: "Dining", spentCents: 7000, limitCents: 10000 },
    ];
    expect(computeOverBudgetTrends(rows, { ym: "2025-05", reference: earlyMayRef })).toHaveLength(0);
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

  it("ignores categories already over budget", () => {
    const prior = new Map([["c1", { categoryId: "c1", spentCents: 3100, limitCents: 10000 }]]);
    const rows = [{ categoryId: "c1", categoryName: "Dining", spentCents: 12000, limitCents: 10000 }];
    expect(computeMonthOverMonthTrends(rows, prior, { ym: "2025-05", reference: mayRef })).toHaveLength(0);
  });

  it("stays quiet too early in the month", () => {
    const prior = new Map([["c1", { categoryId: "c1", spentCents: 3100, limitCents: 10000 }]]);
    const rows = [{ categoryId: "c1", categoryName: "Dining", spentCents: 5000, limitCents: 10000 }];
    expect(computeMonthOverMonthTrends(rows, prior, { ym: "2025-05", reference: earlyMayRef })).toHaveLength(0);
  });
});

describe("formatBudgetWarningMessage", () => {
  it("formats user-facing warning copy", () => {
    expect(formatBudgetWarningMessage("Dining", 82, 12)).toBe(
      "Dining is 82% used with 12 days left.",
    );
    expect(percentUsed(8200, 10000)).toBe(82);
  });

  it("includes remaining dollars when provided", () => {
    expect(formatBudgetWarningMessage("Dining", 85, 12, 150)).toBe(
      `Dining is 85% used — ${formatCurrency(150)} left, 12 days left.`,
    );
  });

  it("uses singular day label at one day left", () => {
    expect(formatBudgetWarningMessage("Dining", 85, 1, 150)).toBe(
      `Dining is 85% used — ${formatCurrency(150)} left, 1 day left.`,
    );
  });
});

describe("formatBudgetOverBudgetMessage", () => {
  it("states the over-budget amount", () => {
    expect(formatBudgetOverBudgetMessage("Dining", 300)).toBe(
      `Dining is over budget by ${formatCurrency(300)}.`,
    );
  });
});
