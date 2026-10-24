import { describe, expect, it } from "vitest";
import { tx } from "@/lib/insights/test-fixtures";
import { buildYearSummary, looksTaxRelated, yearWindow } from "./year-summary";

const tags = [
  { id: "t-don", name: "Donation" },
  { id: "t-trip", name: "Trip" },
  { id: "t-med", name: "Medical" },
];

describe("year-end summary", () => {
  it("totals the year, compares spending with last year, and finds the biggest month", () => {
    const s = buildYearSummary({
      year: 2025,
      todayYmd: "2026-03-01",
      tags,
      flows: [],
      txs: [
        tx("2024-04-01", "Old", 50_000),
        tx("2025-01-10", "Groceries", 20_000, { categoryName: "Food", categoryId: "food" }),
        tx("2025-06-15", "Couch", 60_000, { categoryName: "Home", categoryId: "home" }),
        tx("2025-06-20", "Refund", -10_000, { categoryName: "Home", categoryId: "home" }),
        tx("2025-07-01", "Pay", 200_000, { type: "INCOME", categoryName: "Salary", categoryId: "pay" }),
        tx("2026-01-05", "Next year", 99_999),
      ],
    });
    expect(s.toDate).toBe(false);
    expect(s.incomeCents).toBe(200_000);
    expect(s.spendingCents).toBe(70_000);
    expect(s.netCents).toBe(130_000);
    expect(s.previousSpendingCents).toBe(50_000);
    expect(s.months).toHaveLength(12);
    expect(s.biggestMonth?.ym).toBe("2025-06");
    expect(s.topCategories.map((c) => [c.categoryName, c.cents])).toEqual([
      ["Home", 50_000],
      ["Food", 20_000],
    ]);
  });

  it("adds up each tag, tax-looking ones first, and registered account flows within the year", () => {
    const s = buildYearSummary({
      year: 2026,
      todayYmd: "2026-10-24",
      tags,
      txs: [
        { ...tx("2026-02-01", "Big trip", 300_000), tagIds: ["t-trip"] },
        { ...tx("2026-03-01", "Red Cross", 10_000), tagIds: ["t-don"] },
        { ...tx("2026-04-01", "Food bank", 5_000), tagIds: ["t-don"] },
        { ...tx("2026-05-01", "Dentist", 20_000), tagIds: ["t-med", "t-trip"] },
        { ...tx("2026-11-01", "Future", 1), tagIds: ["t-don"] },
      ],
      flows: [
        { accountId: "rrsp", accountName: "My RRSP", accountType: "RRSP", date: new Date("2026-02-01T00:00:00Z"), direction: "CONTRIBUTION", amountCents: 500_000 },
        { accountId: "rrsp", accountName: "My RRSP", accountType: "RRSP", date: new Date("2026-05-01T00:00:00Z"), direction: "WITHDRAWAL", amountCents: 100_000 },
        { accountId: "rrsp", accountName: "My RRSP", accountType: "RRSP", date: new Date("2025-12-31T00:00:00Z"), direction: "CONTRIBUTION", amountCents: 999 },
      ],
    });
    expect(s.toDate).toBe(true);
    expect(s.months).toHaveLength(10);
    expect(s.tags.map((t) => [t.name, t.taxRelated, t.count, t.spentCents])).toEqual([
      ["Medical", true, 1, 20_000],
      ["Donation", true, 2, 15_000],
      ["Trip", false, 2, 320_000],
    ]);
    expect(s.registered).toEqual([
      { accountId: "rrsp", accountName: "My RRSP", accountType: "RRSP", contributedCents: 500_000, withdrawnCents: 100_000 },
    ]);
  });

  it("runs the current year to today and recognises tax-time tag names", () => {
    const w = yearWindow(2026, "2026-10-24");
    expect(w.end).toEqual(new Date(Date.UTC(2026, 9, 25)));
    expect(yearWindow(2025, "2026-10-24").end).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(looksTaxRelated("Tax deductible")).toBe(true);
    expect(looksTaxRelated("Charity")).toBe(true);
    expect(looksTaxRelated("Vacation")).toBe(false);
  });
});
