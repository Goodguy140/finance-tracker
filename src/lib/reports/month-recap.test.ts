import { describe, expect, it } from "vitest";
import type { ReportTx } from "./index";
import { buildMonthRecap, defaultRecapYm } from "./month-recap";

let n = 0;
function tx(ymd: string, type: "EXPENSE" | "INCOME", cents: number, categoryName: string, title?: string): ReportTx {
  n += 1;
  return {
    id: `t${n}`,
    type,
    amountCents: cents,
    date: new Date(`${ymd}T00:00:00Z`),
    title: title ?? null,
    note: null,
    categoryId: categoryName.toLowerCase(),
    categoryName,
    accountId: null,
    recurringTransactionId: null,
    splits: [],
  } as ReportTx;
}

const txs = [
  tx("2026-08-31", "EXPENSE", 99_999, "Food", "Too early"),
  tx("2026-09-02", "EXPENSE", 20_000, "Food"),
  tx("2026-09-05", "EXPENSE", 10_000, "Fun"),
  tx("2026-09-15", "INCOME", 300_000, "Salary"),
  tx("2026-10-01", "EXPENSE", 50_000, "Food", "Big shop"),
  tx("2026-10-03", "EXPENSE", 10_500, "Fun"),
  tx("2026-10-04", "EXPENSE", -2_000, "Food", "Refund"),
  tx("2026-10-15", "INCOME", 310_000, "Salary"),
  tx("2026-11-01", "EXPENSE", 77_777, "Food", "Next month"),
];

describe("buildMonthRecap", () => {
  const recap = buildMonthRecap({
    ym: "2026-10",
    txs,
    budgets: [
      { categoryName: "Food", spentCents: 48_000, limitCents: 40_000, carryCents: 0 },
      { categoryName: "Fun", spentCents: 10_500, limitCents: 15_000, carryCents: 0 },
    ],
  });

  it("totals only the month, against the month before", () => {
    expect(recap.spendingCents).toBe(58_500);
    expect(recap.incomeCents).toBe(310_000);
    expect(recap.netCents).toBe(251_500);
    expect(recap.previousSpendingCents).toBe(30_000);
    expect(recap.previousIncomeCents).toBe(300_000);
    expect(recap.transactionCount).toBe(4);
  });

  it("lists categories with last month beside them, and flags the big movers only", () => {
    expect(recap.categories).toEqual([
      { categoryName: "Food", cents: 48_000, previousCents: 20_000 },
      { categoryName: "Fun", cents: 10_500, previousCents: 10_000 },
    ]);
    expect(recap.changes.map((c) => c.categoryName)).toEqual(["Food"]);
  });

  it("splits budgets into kept and missed, and ranks purchases", () => {
    expect(recap.budgetsKept.map((b) => b.categoryName)).toEqual(["Fun"]);
    expect(recap.budgetsMissed.map((b) => b.categoryName)).toEqual(["Food"]);
    expect(recap.biggest[0]).toEqual({ dateYmd: "2026-10-01", title: "Big shop", cents: 50_000 });
    expect(recap.biggest.map((b) => b.title)).not.toContain("Refund");
  });
});

describe("defaultRecapYm", () => {
  it("is the month just finished, across a year end", () => {
    expect(defaultRecapYm("2026-01-04")).toBe("2025-12");
  });
});
