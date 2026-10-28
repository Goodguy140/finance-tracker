import { describe, expect, it } from "vitest";
import type { ReportTx } from "./index";
import { categoryTrend } from "./category-trend";

let n = 0;
function tx(ymd: string, cents: number, categoryId: string, title: string, opts: Partial<ReportTx> = {}): ReportTx {
  n += 1;
  return {
    id: `t${n}`,
    type: "EXPENSE",
    amountCents: cents,
    date: new Date(`${ymd}T00:00:00Z`),
    title,
    note: null,
    categoryId,
    categoryName: categoryId,
    accountId: null,
    recurringTransactionId: null,
    splits: [],
    merchantName: null,
    ...opts,
  } as ReportTx;
}

const txs = [
  tx("2026-07-03", 100_00, "food", "Sobeys"),
  tx("2026-08-03", 150_00, "food", "Sobeys"),
  tx("2026-08-20", 60_00, "food", "Costco"),
  tx("2026-08-21", -10_00, "food", "Costco"), // refund
  tx("2026-10-02", 90_00, "food", "Sobeys"),
  tx("2026-10-05", 50_00, "fun", "Cinema"),
  tx("2026-10-06", 200_00, "costco", "Costco", {
    splits: [
      { categoryId: "food", categoryName: "food", amountCents: 120_00 },
      { categoryId: "home", categoryName: "home", amountCents: 80_00 },
    ],
  }),
  tx("2026-10-07", 3_000_00, "food", "Payroll", { type: "INCOME" }), // not spending
];

describe("categoryTrend", () => {
  const trend = categoryTrend({
    txs,
    categoryId: "food",
    kind: "EXPENSE",
    budgets: [
      { periodMonth: "2026-08", limitCents: 200_00 },
      { periodMonth: "2026-10", limitCents: 250_00 },
    ],
    todayYmd: "2026-10-10",
  })!;

  it("lists every month from the first to this one, quiet months included, with the budget in force", () => {
    expect(trend.months.map((m) => [m.ym, m.cents, m.budgetCents])).toEqual([
      ["2026-07", 100_00, null],
      ["2026-08", 200_00, 200_00],
      ["2026-09", 0, 200_00],
      ["2026-10", 210_00, 250_00],
    ]);
  });

  it("averages the full months and projects this one from the rate so far", () => {
    expect(trend.averageCents).toBe(100_00);
    expect(trend.averageMonths).toBe(3);
    expect(trend.thisMonth).toEqual({ cents: 210_00, paceCents: 651_00, budgetCents: 250_00 });
  });

  it("ranks payees and purchases by what went into this category, split parts included", () => {
    expect(trend.payees.map((p) => [p.label, p.cents, p.count])).toEqual([
      ["Sobeys", 340_00, 3],
      ["Costco", 170_00, 3],
    ]);
    expect(trend.biggest.map((b) => [b.title, b.cents, b.split])).toEqual([
      ["Sobeys", 150_00, false],
      ["Costco", 120_00, true],
      ["Sobeys", 100_00, false],
      ["Sobeys", 90_00, false],
      ["Costco", 60_00, false],
    ]);
  });

  it("is null for a category with nothing in it", () => {
    expect(categoryTrend({ txs, categoryId: "none", kind: "EXPENSE", budgets: [], todayYmd: "2026-10-10" })).toBeNull();
  });

  it("counts income for an income category", () => {
    expect(categoryTrend({ txs, categoryId: "food", kind: "INCOME", budgets: [], todayYmd: "2026-10-10" })?.thisMonth.cents).toBe(3_000_00);
  });

  it("caps the chart at 24 months", () => {
    const old = categoryTrend({ txs: [tx("2020-01-01", 5_00, "x", "Old")], categoryId: "x", kind: "EXPENSE", budgets: [], todayYmd: "2026-10-10" })!;
    expect(old.months).toHaveLength(24);
    expect(old.months[0].ym).toBe("2024-11");
  });
});
