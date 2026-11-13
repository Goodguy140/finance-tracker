import { describe, expect, it } from "vitest";
import { computeSafeToSpend, daysLeftInMonth, parseSafeToSpendBufferDays, safeToSpendForecastDays } from "./safe-to-spend";

const base = {
  todayYmd: "2026-10-20",
  incomeReceivedCents: 300_000,
  spentCents: 120_000,
  occurrences: [],
  budgets: [],
  goalContributionsCents: [],
};

describe("computeSafeToSpend", () => {
  it("starts from income received less spending", () => {
    expect(computeSafeToSpend(base).safeCents).toBe(180_000);
  });

  it("adds income still expected and takes bills still due this month", () => {
    const result = computeSafeToSpend({
      ...base,
      occurrences: [
        { type: "INCOME", amountCents: 150_000, categoryId: "pay", dateYmd: "2026-10-30" },
        { type: "EXPENSE", amountCents: 20_000, categoryId: "phone", dateYmd: "2026-10-25" },
        // Next month: not this month's money.
        { type: "EXPENSE", amountCents: 99_999, categoryId: "phone", dateYmd: "2026-11-02" },
      ],
    });
    expect(result.expectedIncomeCents).toBe(150_000);
    expect(result.billsDueCents).toBe(20_000);
    expect(result.safeCents).toBe(180_000 + 150_000 - 20_000);
  });

  it("holds back what is left in budgets, and does not count a budgeted bill twice", () => {
    const result = computeSafeToSpend({
      ...base,
      occurrences: [{ type: "EXPENSE", amountCents: 5_000, categoryId: "groceries", dateYmd: "2026-10-28" }],
      budgets: [
        { categoryId: "groceries", limitCents: 60_000, spentCents: 40_000 },
        // Over budget: holds back nothing, the overspend is already in spending.
        { categoryId: "dining", limitCents: 10_000, spentCents: 15_000 },
      ],
    });
    expect(result.budgetLeftCents).toBe(20_000);
    expect(result.billsDueCents).toBe(0);
    expect(result.safeCents).toBe(160_000);
  });

  it("takes planned goal contributions and spreads the rest over the days left", () => {
    const result = computeSafeToSpend({ ...base, goalContributionsCents: [30_000, 6_000] });
    expect(result.goalsCents).toBe(36_000);
    expect(result.safeCents).toBe(144_000);
    expect(result.daysLeft).toBe(12);
    expect(result.perDayCents).toBe(12_000);
  });

  it("reports nothing per day when the month is already over-committed", () => {
    const result = computeSafeToSpend({ ...base, spentCents: 400_000 });
    expect(result.safeCents).toBe(-100_000);
    expect(result.perDayCents).toBe(0);
  });
});

describe("the bill buffer", () => {
  // The 28th: rent on the 1st and the phone bill on the 6th are next month's.
  const lateInMonth = {
    ...base,
    todayYmd: "2026-10-28",
    occurrences: [
      { type: "EXPENSE" as const, amountCents: 20_000, categoryId: "phone", dateYmd: "2026-10-30" },
      { type: "EXPENSE" as const, amountCents: 150_000, categoryId: "rent", dateYmd: "2026-11-01" },
      { type: "EXPENSE" as const, amountCents: 8_000, categoryId: "phone", dateYmd: "2026-11-06" },
      { type: "INCOME" as const, amountCents: 300_000, categoryId: "pay", dateYmd: "2026-11-02" },
    ],
    // Rent is budgeted; this month's remainder does not hold next month's rent.
    budgets: [{ categoryId: "rent", limitCents: 150_000, spentCents: 150_000 }],
  };

  it("also holds back next month's bills due within the buffer, whatever their category, but not next month's pay", () => {
    const result = computeSafeToSpend({ ...lateInMonth, bufferDays: 5 });
    expect(result.bufferUntilYmd).toBe("2026-11-02");
    expect(result.bufferBillsCents).toBe(150_000);
    expect(result.billsDueCents).toBe(20_000);
    expect(result.expectedIncomeCents).toBe(0);
    expect(result.safeCents).toBe(180_000 - 20_000 - 150_000);
    expect(computeSafeToSpend({ ...lateInMonth, bufferDays: 9 }).bufferBillsCents).toBe(158_000);
  });

  it("changes nothing without a buffer or when it ends inside the month", () => {
    const off = computeSafeToSpend(lateInMonth);
    expect(off).toMatchObject({ bufferDays: null, bufferUntilYmd: null, bufferBillsCents: 0, safeCents: 160_000 });
    const inside = computeSafeToSpend({ ...lateInMonth, bufferDays: 3 });
    expect(inside).toMatchObject({ bufferDays: 3, bufferUntilYmd: null, bufferBillsCents: 0, safeCents: 160_000 });
  });

  it("makes the forecast reach the buffer's last day", () => {
    expect(safeToSpendForecastDays("2026-10-28", null)).toBe(4);
    expect(safeToSpendForecastDays("2026-10-28", 9)).toBe(9);
    expect(safeToSpendForecastDays("2026-10-02", 9)).toBe(30);
  });

  it("takes whole days from 1 to 60, or empty for none", () => {
    expect(parseSafeToSpendBufferDays("")).toBeNull();
    expect(parseSafeToSpendBufferDays(" 7 ")).toBe(7);
    for (const bad of ["0", "61", "2.5", "-3", "soon"]) expect(() => parseSafeToSpendBufferDays(bad)).toThrow(/1 to 60/);
  });
});

describe("daysLeftInMonth", () => {
  it("counts today", () => {
    expect(daysLeftInMonth("2026-02-28")).toBe(1);
    expect(daysLeftInMonth("2024-02-01")).toBe(29);
  });
});
