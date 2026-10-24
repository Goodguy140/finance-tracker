import { describe, expect, it } from "vitest";
import { tx } from "@/lib/insights/test-fixtures";
import {
  cashFlow,
  filterByTag,
  incomeVsSpendingByMonth,
  merchantActivity,
  merchantSummaries,
  previousYearWindow,
  reportPeriodParam,
  resolveReportPeriod,
  yearOverYearByCategory,
  yearsWithActivity,
} from "./index";

const income = (date: string, title: string, cents: number, categoryName = "Salary") =>
  tx(date, title, cents, { type: "INCOME", categoryId: `cat-${categoryName}`, categoryName });
const expense = (date: string, title: string, cents: number, categoryName = "Groceries") =>
  tx(date, title, cents, { categoryId: `cat-${categoryName}`, categoryName });
const transfer = (date: string, cents: number) =>
  tx(date, "Card payment", cents, { type: "TRANSFER", categoryId: "cat-transfers", categoryName: "Transfers" });

describe("resolveReportPeriod", () => {
  it("defaults to the trailing twelve months through today", () => {
    const p = resolveReportPeriod(undefined, "2026-10-06");
    expect(p.key).toBe("12m");
    expect(p.months[0]).toBe("2025-11");
    expect(p.months.at(-1)).toBe("2026-10");
    expect(p.months).toHaveLength(12);
    expect(p.start.toISOString()).toBe("2025-11-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });

  it("runs a past year to its end and the current year to today", () => {
    const past = resolveReportPeriod("2025", "2026-10-06");
    expect(past.months).toHaveLength(12);
    expect(past.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(past.toDate).toBe(false);

    const running = resolveReportPeriod("2026", "2026-10-06");
    expect(running.months.at(-1)).toBe("2026-10");
    expect(running.end.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(running.label).toBe("2026 to date");
  });

  it("ignores future years and junk", () => {
    expect(resolveReportPeriod("2030", "2026-10-06").key).toBe("12m");
    expect(resolveReportPeriod("abc", "2026-10-06").key).toBe("12m");
  });

  it("compares against the same dates a year earlier", () => {
    const prev = previousYearWindow(resolveReportPeriod("2026", "2026-10-06"));
    expect(prev.start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(prev.end.toISOString()).toBe("2025-10-07T00:00:00.000Z");
  });
});

describe("incomeVsSpendingByMonth", () => {
  it("totals each month, keeps quiet months, and leaves transfers out", () => {
    const rows = incomeVsSpendingByMonth(
      [
        income("2026-08-01", "Pay", 300_000),
        expense("2026-08-03", "Store", 50_000),
        expense("2026-08-09", "Store refund", -5_000),
        transfer("2026-08-10", 100_000),
        expense("2026-10-01", "Store", 20_000),
        expense("2026-07-31", "Outside the period", 99_999),
      ],
      ["2026-08", "2026-09", "2026-10"],
    );
    expect(rows.map((r) => [r.ym, r.incomeCents, r.spendingCents, r.netCents])).toEqual([
      ["2026-08", 300_000, 45_000, 255_000],
      ["2026-09", 0, 0, 0],
      ["2026-10", 0, 20_000, -20_000],
    ]);
  });
});

describe("cashFlow", () => {
  it("balances income against spending by category plus what was saved", () => {
    const flow = cashFlow([
      income("2026-08-01", "Pay", 300_000, "Salary"),
      income("2026-08-15", "Interest", 1_000, "Interest"),
      expense("2026-08-03", "Rent", 150_000, "Housing"),
      expense("2026-08-04", "Store", 50_000, "Groceries"),
      transfer("2026-08-10", 75_000),
    ]);
    expect(flow.incomeCents).toBe(301_000);
    expect(flow.spendingCents).toBe(200_000);
    expect(flow.nodes.map((n) => [n.name, n.cents])).toEqual([
      ["Salary", 300_000],
      ["Interest", 1_000],
      ["Income", 301_000],
      ["Housing", 150_000],
      ["Groceries", 50_000],
      ["Saved", 101_000],
    ]);
    const hub = flow.nodes.findIndex((n) => n.kind === "hub");
    const into = flow.links.filter((l) => l.target === hub).reduce((s, l) => s + l.value, 0);
    const out = flow.links.filter((l) => l.source === hub).reduce((s, l) => s + l.value, 0);
    expect(into).toBe(out);
    expect(flow.nodes.some((n) => n.name === "Transfers")).toBe(false);
  });

  it("draws overspending as money from savings and net refunds as an inflow", () => {
    const flow = cashFlow([
      income("2026-08-01", "Pay", 100_000),
      expense("2026-08-03", "Rent", 150_000, "Housing"),
      expense("2026-08-04", "Return", -2_000, "Clothing"),
    ]);
    const names = flow.nodes.map((n) => [n.name, n.kind, n.cents]);
    expect(names).toContainEqual(["Refunds", "refunds", 2_000]);
    expect(names).toContainEqual(["From savings", "shortfall", 48_000]);
    expect(flow.nodes.some((n) => n.kind === "saved")).toBe(false);
    expect(flow.links.every((l) => l.value > 0)).toBe(true);
  });

  it("splits what moved into savings accounts out of the leftover", () => {
    const txs = [income("2026-08-01", "Pay", 300_000), expense("2026-08-03", "Rent", 200_000, "Housing")];
    const flow = cashFlow(txs, { toSavingsCents: 60_000 });
    expect(flow.nodes.map((n) => [n.name, n.kind, n.cents])).toEqual([
      ["Salary", "income", 300_000],
      ["Income", "hub", 300_000],
      ["Housing", "expense", 200_000],
      ["To savings", "savings", 60_000],
      ["Left in accounts", "saved", 40_000],
    ]);

    // More moved to savings than was left over: the rest came out of account balances.
    const over = cashFlow(txs, { toSavingsCents: 130_000 });
    expect(over.nodes.map((n) => [n.name, n.cents])).toContainEqual(["From account balances", 30_000]);
    expect(over.nodes.some((n) => n.kind === "saved")).toBe(false);

    // Money taken out of savings is a source, not a negative band.
    const withdrawn = cashFlow(txs, { toSavingsCents: -50_000 });
    expect(withdrawn.nodes.map((n) => [n.name, n.cents])).toContainEqual(["From savings accounts", 50_000]);
    expect(withdrawn.nodes.map((n) => [n.name, n.cents])).toContainEqual(["Left in accounts", 150_000]);

    for (const f of [flow, over, withdrawn]) {
      const hub = f.nodes.findIndex((n) => n.kind === "hub");
      const into = f.links.filter((l) => l.target === hub).reduce((s, l) => s + l.value, 0);
      const out = f.links.filter((l) => l.source === hub).reduce((s, l) => s + l.value, 0);
      expect(into).toBe(out);
      expect(f.nodes[hub].cents).toBe(into);
    }
  });

  it("attributes split expenses to their parts and folds the tail into one band", () => {
    const split = expense("2026-08-03", "Costco", 10_000, "Groceries");
    split.splits = [
      { categoryId: "a", categoryName: "Groceries", amountCents: 6_000 },
      { categoryId: "b", categoryName: "Household", amountCents: 4_000 },
    ];
    const flow = cashFlow(
      [
        income("2026-08-01", "Pay", 100_000),
        split,
        expense("2026-08-05", "x", 3_000, "Fun"),
        expense("2026-08-05", "y", 1_000, "Gifts"),
      ],
      { maxExpenseNodes: 3 },
    );
    expect(flow.nodes.filter((n) => n.kind === "expense").map((n) => [n.name, n.cents])).toEqual([
      ["Groceries", 6_000],
      ["Household", 4_000],
      ["Everything else", 4_000],
    ]);
  });

  it("is empty with nothing to show", () => {
    expect(cashFlow([transfer("2026-08-10", 5_000)]).nodes).toEqual([]);
  });
});

describe("yearOverYearByCategory", () => {
  it("compares each category with the same window a year earlier", () => {
    const period = resolveReportPeriod("2026", "2026-10-06");
    const result = yearOverYearByCategory(
      [
        expense("2026-03-01", "a", 40_000, "Groceries"),
        expense("2025-03-01", "b", 20_000, "Groceries"),
        expense("2025-11-01", "after last year's matching date", 99_000, "Groceries"),
        expense("2026-02-01", "c", 5_000, "Travel"),
        expense("2025-05-01", "d", 7_000, "Gym"),
        transfer("2026-03-01", 10_000),
        income("2026-03-01", "Pay", 10_000),
      ],
      period,
    );
    expect(result.rows.map((r) => [r.categoryName, r.currentCents, r.previousCents, r.changeRatio])).toEqual([
      ["Groceries", 40_000, 20_000, 1],
      ["Travel", 5_000, 0, null],
      ["Gym", 0, 7_000, -1],
    ]);
    expect(result.currentTotalCents).toBe(45_000);
    expect(result.previousTotalCents).toBe(27_000);
  });
});

describe("merchants", () => {
  const rows = [
    expense("2026-06-02", "SQ *BLUE BOTTLE #412", 600, "Coffee"),
    expense("2026-08-20", "Blue Bottle", 550, "Coffee"),
    expense("2026-08-21", "Blue Bottle", -550, "Coffee"),
    expense("2026-08-01", "Landlord", 150_000, "Housing"),
    income("2026-08-01", "Acme Payroll", 300_000),
    transfer("2026-08-10", 75_000),
    expense("2026-08-11", "", 999, "Misc"),
  ];

  it("groups payees by cleaned name, biggest spend first", () => {
    const list = merchantSummaries(rows);
    expect(list.map((m) => [m.label, m.count, m.spentCents, m.receivedCents])).toEqual([
      ["Landlord", 1, 150_000, 0],
      ["Blue Bottle", 3, 600, 0],
      ["Acme Payroll", 1, 0, 300_000],
    ]);
  });

  it("shows everything from one payee with quiet months filled in", () => {
    const key = merchantSummaries(rows).find((m) => m.label === "Blue Bottle")!.key;
    const activity = merchantActivity(rows, key)!;
    expect(activity.transactions).toHaveLength(3);
    expect(activity.transactions[0].date.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect(activity.months.map((m) => [m.ym, m.spentCents])).toEqual([
      ["2026-06", 600],
      ["2026-07", 0],
      ["2026-08", 0],
    ]);
    expect(activity.categories).toEqual([{ categoryName: "Coffee", spentCents: 600 }]);
    expect(merchantActivity(rows, "nobody")).toBeNull();
  });
});

describe("yearsWithActivity", () => {
  it("lists years with data newest first, always including this year", () => {
    expect(yearsWithActivity([new Date("2024-05-01"), new Date("2025-01-01")], "2026-10-06")).toEqual([
      "2026",
      "2025",
      "2024",
    ]);
  });
});

describe("filterByTag", () => {
  it("keeps only rows carrying the tag, and everything without one", () => {
    const tagged = { ...expense("2026-08-01", "Hotel", 20_000, "Travel"), tagIds: ["trip"] };
    const plain = expense("2026-08-02", "Store", 5_000);
    expect(filterByTag([tagged, plain], "trip")).toEqual([tagged]);
    expect(filterByTag([tagged, plain], null)).toHaveLength(2);
  });
});

describe("a custom report period", () => {
  it("covers the days picked, by month, with a key that survives a link", () => {
    const p = resolveReportPeriod("2026-03-15_2026-05-10", "2026-10-06");
    expect(p.key).toBe("2026-03-15_2026-05-10");
    expect(p.label).toBe("Mar 15 – May 10, 2026");
    expect(p.months).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(p.start).toEqual(new Date(Date.UTC(2026, 2, 15)));
    expect(p.end).toEqual(new Date(Date.UTC(2026, 4, 11)));
    expect(p.toDate).toBe(false);
    // The form's from/to win over a period already in the URL.
    expect(reportPeriodParam({ period: "2025", from: "2026-03-15", to: "2026-05-10" })).toBe("2026-03-15_2026-05-10");
    expect(reportPeriodParam({ period: "2025", from: "2026-05-10", to: "2026-03-15" })).toBe("2025");
  });
});
