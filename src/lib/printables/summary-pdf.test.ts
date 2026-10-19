import { describe, expect, it } from "vitest";
import type { SummaryData } from "./summary-data";
import { renderSummaryPdf } from "./summary-pdf";
import { pdfPageTexts } from "./test-pdf-text";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const months = ["2026-08", "2026-09", "2026-10"];

function summary(overrides: Partial<SummaryData> = {}): SummaryData {
  return {
    displayName: "Sam Sample",
    currency: "CAD",
    todayYmd: "2026-10-14",
    period: { key: "2026", label: "2026", toDate: true },
    comparisonLabel: "the same dates in 2025",
    tagName: null,
    otherCurrencyNote: "",
    totals: { incomeCents: 1_500_000, spendingCents: 1_120_000, netCents: 380_000, toSavingsCents: null },
    months: months.map((ym, i) => ({
      ym,
      label: ym,
      incomeCents: 500_000,
      spendingCents: 350_000 + i * 10_000,
      netCents: 150_000 - i * 10_000,
      toSavingsCents: null,
    })),
    categories: [
      { categoryId: "c1", name: "Groceries", color: "#38bdf8", currentCents: 620_000, previousCents: 580_000, changeRatio: 0.069 },
      { categoryId: "c2", name: "Dining", color: "#a78bfa", currentCents: 500_000, previousCents: 0, changeRatio: null },
    ],
    previousSpendingCents: 580_000,
    payees: [{ key: "freshco", label: "FreshCo", count: 14, spentCents: 410_000, receivedCents: 0, lastDate: d("2026-10-10") }],
    budgets: {
      periodMonth: "2026-10",
      currency: "CAD",
      budgets: [
        {
          id: "b1",
          categoryId: "c1",
          categoryName: "Groceries",
          spentCents: 32_000,
          limitCents: 70_000,
          baseLimitCents: 60_000,
          carryCents: 10_000,
          progressPct: 45,
        },
      ],
      totalLimitCents: 70_000,
      totalSpentCents: 32_000,
    },
    score: {
      status: "scored",
      score: 72,
      band: "Good",
      months: ["2026-04", "2026-09"],
      factors: [
        { id: "savings", label: "Savings rate", score: 80, weight: 0.5, detail: "25% of income saved", suggestion: null },
        { id: "budgets", label: "Budgets kept", score: 40, weight: 0.5, detail: "2 of 5 kept", suggestion: "Trim dining" },
      ],
      suggestions: ["Trim dining out by $50 a month."],
      omitted: [],
      cushion: null,
      otherCurrencyAccounts: [],
    },
    netWorth: {
      currency: "CAD",
      points: [
        { ym: "2026-09", label: "Sep", assetsCents: 2_000_000, liabilitiesCents: 300_000, netCents: 1_700_000 },
        { ym: "2026-10", label: "Oct", assetsCents: 2_100_000, liabilitiesCents: 250_000, netCents: 1_850_000 },
      ],
      assetsCents: 2_100_000,
      liabilitiesCents: 250_000,
      netCents: 1_850_000,
      accounts: [
        {
          accountId: "a1",
          name: "Everyday Chequing",
          type: "CHEQUING",
          currency: "CAD",
          liability: false,
          latest: { cents: 2_100_000, date: d("2026-10-12"), source: "MANUAL" },
          counted: true,
        },
        {
          accountId: "a2",
          name: "Rewards Visa",
          type: "CREDIT_CARD",
          currency: "CAD",
          liability: true,
          latest: { cents: 250_000, date: d("2026-10-12"), source: "MANUAL" },
          counted: true,
        },
      ],
    },
    projection: { netCents: [1_850_000, 1_900_000, 1_950_000, 2_000_000], accounts: [], rulesLeftOut: 0, includesTransfers: false, transfersLeftOut: 0 },
    goals: [
      {
        id: "g1",
        name: "Trip to Lisbon",
        targetCents: 400_000,
        targetYmd: "2027-06-01",
        manualSavedCents: 150_000,
        account: null,
        currency: "CAD",
        progress: {
          savedCents: 150_000,
          remainingCents: 250_000,
          fraction: 0.375,
          status: "needs",
          monthsLeft: 8,
          monthlyNeededCents: 31_250,
          monthlyPaceCents: null,
          monthlyTransferCents: null,
          projectedYmd: null,
          paceSource: null,
        },
      },
    ],
    bills: {
      days: 30,
      items: [
        { date: d("2026-10-20"), name: "Hydro bill", type: "EXPENSE", amountCents: 9_500, accountName: "Everyday Chequing", overdue: false },
        { date: d("2026-10-30"), name: "Payday", type: "INCOME", amountCents: 250_000, accountName: "Everyday Chequing", overdue: false },
      ],
      incomeCents: 250_000,
      expenseCents: 9_500,
      netCents: 240_500,
    },
    contributionRoom: [
      {
        accountType: "TFSA",
        year: 2026,
        startingRoomCents: 700_000,
        source: "entered",
        estimatedFromYear: null,
        contributedCents: 200_000,
        withdrawnCents: 0,
        remainingCents: 500_000,
        overCents: 0,
        penaltyExcessCents: 0,
      },
    ],
    ...overrides,
  };
}

describe("renderSummaryPdf", () => {
  it("puts every section's figures on the page", async () => {
    const text = (await pdfPageTexts(await renderSummaryPdf(summary()))).join("\n");
    for (const expected of [
      "Financial summary",
      "Sam Sample  |  2026 (this month is still running)",
      "$15,000.00", // income
      "$11,200.00", // spending
      "72 / 100",
      "Savings rate",
      "Trim dining out by $50 a month.",
      "Income vs spending by month",
      "Groceries",
      "+7%",
      "Budgets, October 2026",
      "$600.00", // base budget
      "$100.00", // rollover carry
      "$380.00", // left of the $700 limit
      "Everyday Chequing",
      "-$2,500.00", // the card, as owed
      "$18,500.00", // net worth
      "Hydro bill",
      "+$2,500.00",
      "Trip to Lisbon",
      "$312.50",
      "TFSA",
      "$5,000.00",
      "FreshCo",
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it("says what is missing instead of leaving a section empty", async () => {
    const text = (
      await pdfPageTexts(
        await renderSummaryPdf(
          summary({
            score: { status: "insufficient", reason: "Needs a full month of entries." },
            goals: [],
            bills: { days: 30, items: [], incomeCents: 0, expenseCents: 0, netCents: 0 },
            budgets: { periodMonth: "2026-10", currency: "CAD", budgets: [], totalLimitCents: 0, totalSpentCents: 0 },
            contributionRoom: [],
            payees: [],
          }),
        ),
      )
    ).join("\n");
    expect(text).toContain("Needs a full month of entries.");
    expect(text).toContain("No savings goals yet.");
    expect(text).toContain("No recurring bills or income coming up.");
    expect(text).toContain("No budgets set.");
    expect(text).not.toContain("Contribution room");
  });

  it("shows saved by transfer and the other-currency note when they apply", async () => {
    const text = (
      await pdfPageTexts(
        await renderSummaryPdf(
          summary({
            totals: { incomeCents: 1_500_000, spendingCents: 1_120_000, netCents: 380_000, toSavingsCents: 200_000 },
            otherCurrencyNote: "spending US$120.00",
            tagName: "travel",
          }),
        ),
      )
    ).join("\n");
    expect(text).toContain("Left over");
    expect(text).toContain("$2,000.00");
    expect(text).toContain("left out of these figures: spending US$120.00");
    expect(text).toContain("#travel");
  });
});
