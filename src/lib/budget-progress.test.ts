import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { computeSpendByCategory, selectActiveBudgetsByCategory, buildBudgetProgressRows, buildRangeBudgetProgressRows } = await import(
  "./budget-progress"
);

describe("computeSpendByCategory", () => {
  it("sums simple expenses by category", () => {
    const spend = computeSpendByCategory([
      { categoryId: "a", amountCents: 1000, splitParts: [] },
      { categoryId: "a", amountCents: 500, splitParts: [] },
      { categoryId: "b", amountCents: 250, splitParts: [] },
    ]);
    expect(spend.get("a")).toBe(1500);
    expect(spend.get("b")).toBe(250);
  });

  it("attributes split transactions to their parts, ignoring the parent category", () => {
    const spend = computeSpendByCategory([
      {
        categoryId: "parent",
        amountCents: 1000,
        splitParts: [
          { categoryId: "a", amountCents: 700 },
          { categoryId: "b", amountCents: 300 },
        ],
      },
    ]);
    expect(spend.get("a")).toBe(700);
    expect(spend.get("b")).toBe(300);
    expect(spend.has("parent")).toBe(false);
  });
});

describe("selectActiveBudgetsByCategory", () => {
  const budgets = [
    { categoryId: "a", periodMonth: "2026-04" },
    { categoryId: "a", periodMonth: "2026-06" },
    { categoryId: "a", periodMonth: "2026-07" }, // future relative to ym
    { categoryId: "b", periodMonth: "2026-01" },
  ];

  it("keeps the latest budget on/before the anchor month per category", () => {
    const active = selectActiveBudgetsByCategory(budgets, "2026-06");
    expect(active.get("a")?.periodMonth).toBe("2026-06");
    expect(active.get("b")?.periodMonth).toBe("2026-01");
  });

  it("excludes budgets dated after the anchor month", () => {
    const active = selectActiveBudgetsByCategory(budgets, "2026-05");
    expect(active.get("a")?.periodMonth).toBe("2026-04");
  });
});

describe("buildBudgetProgressRows", () => {
  const activeBudgets = [
    { id: "z", categoryId: "z", limitCents: 10000, category: { name: "Zoo" } },
    { id: "a", categoryId: "a", limitCents: 20000, category: { name: "Apples" } },
    { id: "n", categoryId: "n", limitCents: 0, category: { name: "NoLimit" } },
  ];

  it("computes clamped progress and sorts rows by category name", () => {
    const spend = new Map([
      ["z", 5000],
      ["a", 40000], // over budget → clamp to 100
    ]);
    const rows = buildBudgetProgressRows(activeBudgets, spend);
    expect(rows.map((r) => r.categoryName)).toEqual(["Apples", "NoLimit", "Zoo"]);

    const apples = rows.find((r) => r.categoryId === "a")!;
    expect(apples.spentCents).toBe(40000);
    expect(apples.progressPct).toBe(100); // clamped

    const zoo = rows.find((r) => r.categoryId === "z")!;
    expect(zoo.progressPct).toBe(50);

    const noLimit = rows.find((r) => r.categoryId === "n")!;
    expect(noLimit.spentCents).toBe(0);
    expect(noLimit.progressPct).toBe(0); // limit 0 → 0, no divide-by-zero
  });
});

describe("buildRangeBudgetProgressRows", () => {
  it("adds up the budget in force each month, carrying one forward until it changes", () => {
    const budgets = [
      { categoryId: "food", periodMonth: "2026-01", limitCents: 50_000, category: { name: "Food" } },
      // Raised from April: January's carries through March.
      { categoryId: "food", periodMonth: "2026-04", limitCents: 60_000, category: { name: "Food" } },
      // Set in March: nothing before it.
      { categoryId: "fun", periodMonth: "2026-03", limitCents: 10_000, category: { name: "Fun" } },
      // After the range: not counted.
      { categoryId: "gas", periodMonth: "2026-06", limitCents: 20_000, category: { name: "Gas" } },
    ];
    const spend = new Map([
      ["food", 230_000],
      ["coffee", 4_000],
    ]);
    const rows = buildRangeBudgetProgressRows(budgets, spend, ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"], () => "Coffee");
    expect(rows.map((r) => [r.categoryName, r.limitCents, r.spentCents, r.carryCents])).toEqual([
      ["Coffee", 0, 4_000, 0],
      ["Food", 3 * 50_000 + 2 * 60_000, 230_000, 0],
      ["Fun", 3 * 10_000, 0, 0],
    ]);
    expect(rows.find((r) => r.categoryId === "food")?.progressPct).toBeCloseTo((230_000 / 270_000) * 100);
  });
});
