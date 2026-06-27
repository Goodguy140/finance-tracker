import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { computeSpendByCategory, selectActiveBudgetsByCategory, buildBudgetProgressRows } = await import(
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
