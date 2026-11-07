import { describe, expect, it } from "vitest";
import { SAVINGS_SLICE_COLOR } from "@/lib/category-colors";
import { dateFromYmd } from "@/lib/date-only";
import { DEFAULT_LAYOUT } from "@/lib/dashboard-layout/cards";
import { buildAppSpending, resolveSpendingSettings, type AppSpendingInput, type SpendingSettings } from "./spending";

const created = new Date("2026-01-01T00:00:00Z");
const categories = [
  { id: "groceries", name: "Groceries", groupName: null, createdAt: created },
  { id: "dining", name: "Dining", groupName: null, createdAt: created },
  { id: "gas", name: "Gas", groupName: null, createdAt: created },
];

function expense(ymd: string, amountCents: number, categoryId = "groceries") {
  return { date: dateFromYmd(ymd), amountCents, categoryId, splitParts: [] };
}

const settings: SpendingSettings = {
  compareWith: "none",
  showExpectedLine: true,
  showSavings: false,
  groupCategories: true,
  maxSlices: 8,
};

function input(overrides: Partial<AppSpendingInput> = {}): AppSpendingInput {
  return {
    ym: "2026-11",
    todayYmd: "2026-11-10",
    currency: "CAD",
    expenses: [expense("2026-11-02", 3_000), expense("2026-11-05", 7_000, "dining"), expense("2026-11-09", 2_000, "gas")],
    pastExpenses: [],
    budgetedMonthlyCents: 60_000,
    categories,
    settings,
    savings: null,
    ...overrides,
  };
}

describe("buildAppSpending: cumulative spending", () => {
  it("runs the total to today, leaves later days empty, and measures it against the budgets' pace", () => {
    const { cumulative } = buildAppSpending(input());
    expect(cumulative.days).toHaveLength(30);
    expect(cumulative.days[4]).toEqual({ day: 5, spentCents: 7_000, totalCents: 10_000, expectedCents: 10_000, comparisonCents: null });
    expect(cumulative.days[9].totalCents).toBe(12_000);
    expect(cumulative.days[10].totalCents).toBeNull();
    // A month's budgets spread over 30 days: 20,000 by the 10th, so 8,000 under.
    expect(cumulative).toMatchObject({ totalCents: 12_000, expectedBasis: "budgets", expectedGapCents: -8_000, comparisonGapCents: null });
  });

  it("draws last month by day of month when asked, and nothing when the card's expected line is off", () => {
    const pastExpenses = [
      { date: dateFromYmd("2026-10-01"), amountCents: 4_000 },
      { date: dateFromYmd("2026-10-08"), amountCents: 10_000 },
      { date: dateFromYmd("2026-10-20"), amountCents: 50_000 },
    ];
    const { cumulative } = buildAppSpending(
      input({ pastExpenses, settings: { ...settings, compareWith: "last-month", showExpectedLine: false } }),
    );
    expect(cumulative.days[9]).toMatchObject({ totalCents: 12_000, comparisonCents: 14_000, expectedCents: null });
    expect(cumulative.days[29].comparisonCents).toBe(64_000);
    expect(cumulative).toMatchObject({ expectedBasis: null, expectedGapCents: null, comparisonGapCents: -2_000 });
  });
});

describe("buildAppSpending: spending by category", () => {
  it("adds groups up, rolls the tail into Other categories, and keeps Savings last", () => {
    const grouped = [
      { ...categories[0], groupName: "Food" },
      { ...categories[1], groupName: "Food" },
      categories[2],
      { id: "fun", name: "Fun", groupName: null, createdAt: created },
      { id: "gifts", name: "Gifts", groupName: null, createdAt: created },
    ];
    const { categories: pie } = buildAppSpending(
      input({
        categories: grouped,
        expenses: [
          expense("2026-11-02", 3_000, "groceries"),
          expense("2026-11-03", 7_000, "dining"),
          expense("2026-11-04", 5_000, "gas"),
          expense("2026-11-05", 1_000, "fun"),
          expense("2026-11-06", 500, "gifts"),
        ],
        settings: { ...settings, showSavings: true, maxSlices: 3 },
        savings: { cents: 20_000, accounts: 1 },
      }),
    );
    expect(pie.grouped).toBe(true);
    expect(pie.totalCents).toBe(16_500);
    expect(pie.slices.map(({ name, cents, kind }) => ({ name, cents, kind }))).toEqual([
      { name: "Food", cents: 10_000, kind: "category" },
      { name: "Gas", cents: 5_000, kind: "category" },
      { name: "Other categories", cents: 1_500, kind: "other" },
      { name: "Savings", cents: 20_000, kind: "savings" },
    ]);
    expect(pie.slices[3].color).toBe(SAVINGS_SLICE_COLOR);
    // Group slices stand for several categories, so none opens a category page.
    expect(pie.slices.some((slice) => "categoryId" in slice)).toBe(false);
  });

  it("keeps categories apart when the card says not to add groups up, and draws no Savings slice for nothing saved", () => {
    const { categories: pie } = buildAppSpending(
      input({
        categories: [{ ...categories[0], groupName: "Food" }, { ...categories[1], groupName: "Food" }, categories[2]],
        settings: { ...settings, groupCategories: false, showSavings: true },
        savings: { cents: 0, accounts: 1 },
      }),
    );
    expect(pie.grouped).toBe(false);
    expect(pie.slices.map((slice) => slice.name)).toEqual(["Dining", "Groceries", "Gas"]);
    expect(pie.slices.map((slice) => ("categoryId" in slice ? slice.categoryId : null))).toEqual(["dining", "groceries", "gas"]);
    expect(pie.savings).toEqual({ cents: 0, accounts: 1 });
  });
});

describe("resolveSpendingSettings", () => {
  const stored = JSON.stringify({
    ...DEFAULT_LAYOUT,
    settings: {
      "cumulative-spend": { compareWith: "three-month-average", showExpectedLine: false },
      "spending-by-category": { showSavings: true, maxSlices: 5, groupCategories: false },
    },
  });

  it("follows the website's card settings, and its defaults for someone who never changed them", () => {
    expect(resolveSpendingSettings(stored, {})).toEqual({
      compareWith: "three-month-average",
      showExpectedLine: false,
      showSavings: true,
      groupCategories: false,
      maxSlices: 5,
    });
    expect(resolveSpendingSettings(null, {})).toEqual(settings);
  });

  it("lets the phone's own choice win", () => {
    expect(resolveSpendingSettings(stored, { compareWith: "none", showSavings: false })).toMatchObject({
      compareWith: "none",
      showSavings: false,
    });
  });
});
