import { describe, expect, it } from "vitest";
import { dateFromYmd } from "@/lib/date-only";
import type { SafeToSpend } from "@/lib/safe-to-spend";
import { buildAppSummary, type AppSummaryInput } from "./summary";

const safeToSpend: SafeToSpend = {
  safeCents: 45_000,
  perDayCents: 3_000,
  daysLeft: 15,
  incomeReceivedCents: 400_000,
  spentCents: 150_000,
  expectedIncomeCents: 0,
  billsDueCents: 20_000,
  bufferDays: null,
  bufferUntilYmd: null,
  bufferBillsCents: 0,
  budgetLeftCents: 185_000,
  goalsCents: 0,
};

function budget(categoryName: string, spentCents: number, limitCents: number) {
  return {
    id: `b-${categoryName}`,
    categoryId: `c-${categoryName}`,
    categoryName,
    spentCents,
    limitCents,
    baseLimitCents: limitCents,
    carryCents: 0,
    progressPct: 0,
  };
}

function occurrence(name: string, type: "EXPENSE" | "INCOME" | "TRANSFER", amountCents: number, ymd: string, extra: { overdue?: boolean; planned?: true } = {}) {
  return {
    rule: { name, type, amountCents, ...(extra.planned ? { planned: extra.planned } : {}) },
    date: dateFromYmd(ymd),
    overdue: extra.overdue ?? false,
    missedSince: null,
  };
}

function input(overrides: Partial<AppSummaryInput> = {}): AppSummaryInput {
  const budgets = [budget("Groceries", 38_000, 40_000), budget("Fun", 5_000, 20_000), budget("Gas", 31_000, 30_000)];
  return {
    todayYmd: "2026-11-16",
    currency: "CAD",
    safeToSpend,
    progress: {
      periodMonth: "2026-11",
      currency: "CAD",
      budgets,
      totalLimitCents: 90_000,
      totalSpentCents: 74_000,
    },
    occurrences: [],
    bankQueueCount: 3,
    needsReviewCount: 2,
    ...overrides,
  };
}

describe("buildAppSummary", () => {
  it("lists only budgets at 80% or more, the most used first", () => {
    const summary = buildAppSummary(input());
    expect(summary.budgets.watch.map((b) => b.categoryName)).toEqual(["Gas", "Groceries"]);
    expect(summary.budgets.watch[0]).toMatchObject({ spentCents: 31_000, limitCents: 30_000 });
    expect(summary.budgets).toMatchObject({ count: 3, totalLimitCents: 90_000, totalSpentCents: 74_000 });
  });

  it("leaves a budget of zero out of the watch list", () => {
    const summary = buildAppSummary(
      input({
        progress: { periodMonth: "2026-11", currency: "CAD", budgets: [budget("Gifts", 1_000, 0)], totalLimitCents: 0, totalSpentCents: 1_000 },
      }),
    );
    expect(summary.budgets.watch).toEqual([]);
  });

  it("lists the week's bills and pay with their totals, and leaves transfers out", () => {
    const summary = buildAppSummary(
      input({
        occurrences: [
          occurrence("Phone", "EXPENSE", 6_500, "2026-11-14", { overdue: true }),
          occurrence("Card payment", "TRANSFER", 50_000, "2026-11-17"),
          occurrence("Pay", "INCOME", 210_000, "2026-11-20"),
          occurrence("Dentist", "EXPENSE", 12_000, "2026-11-21", { planned: true }),
        ],
      }),
    );
    expect(summary.upcoming.items).toEqual([
      { date: "2026-11-14", name: "Phone", type: "expense", amountCents: 6_500, overdue: true, planned: false },
      { date: "2026-11-20", name: "Pay", type: "income", amountCents: 210_000, overdue: false, planned: false },
      { date: "2026-11-21", name: "Dentist", type: "expense", amountCents: 12_000, overdue: false, planned: true },
    ]);
    expect(summary.upcoming).toMatchObject({ days: 7, billsCents: 18_500, incomeCents: 210_000 });
  });

  it("passes safe to spend and the waiting counts through, for the month of today", () => {
    const summary = buildAppSummary(input());
    expect(summary).toMatchObject({ month: "2026-11", today: "2026-11-16", currency: "CAD", safeToSpend });
    expect(summary.waiting).toEqual({ bankQueue: 3, needsReview: 2 });
  });
});
