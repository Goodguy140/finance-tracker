import { describe, expect, it } from "vitest";
import { tx } from "@/lib/insights/test-fixtures";
import { formatCurrency } from "@/lib/money";
import {
  actionPlanCsv,
  blankPlanSteps,
  buildActionPlan,
  carriedCards,
  horizonFor,
  monthlyAverages,
  monthsText,
  nextSteps,
  paidInFull,
  parsePlanRange,
  stepsInRange,
  type ActionPlan,
  type PlanFacts,
} from "./action-plan";
import { renderActionPlanPdf } from "./action-plan-pdf";
import { pdfPageTexts } from "./test-pdf-text";

const fmt = (cents: number) => formatCurrency(cents, "CAD", "en-CA");

/** A household doing some things well and some not: the plan should say both. */
export function sampleFacts(overrides: Partial<PlanFacts> = {}): PlanFacts {
  return {
    currency: "CAD",
    todayYmd: "2026-10-14",
    countryCode: "CA",
    monthsMeasured: 6,
    avgIncomeCents: 530_000,
    avgSpendingCents: 400_000,
    avgSavedCents: 60_000,
    monthsInRed: 1,
    score: {
      status: "scored",
      score: 62,
      band: "Fair",
      months: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      factors: [
        { id: "savings", label: "Savings rate", score: 55, weight: 0.35, detail: "11% of income moved to savings", suggestion: "Moving about $460.00 more a month into savings would bring your savings rate to 20%." },
        { id: "budgets", label: "Budgets kept", score: 60, weight: 0.2, detail: "9 of 15 monthly budgets kept", suggestion: "Dining went over budget in 3 of the last 3 months. Raise the limit to something you can keep, or move room from a category with spare." },
        { id: "trend", label: "Spending trend", score: 80, weight: 0.15, detail: "Spending is flat", suggestion: null },
      ],
      suggestions: [],
      omitted: [],
      cushion: null,
    },
    emergencyFundCents: 450_000,
    // $1,200 owed against $300 charged lately: a balance carried from month to month.
    cards: [{ name: "Visa", balanceCents: 120_000, recentChargesCents: 30_000 }],
    loans: [{ name: "Car Loan", balanceCents: 1_100_000 }],
    hasCardAccount: true,
    topCategories: [
      { name: "Rent", avgCents: 175_000, budgeted: false },
      { name: "Groceries", avgCents: 48_000, budgeted: true },
      { name: "Dining", avgCents: 16_000, budgeted: true },
    ],
    budgetCount: 5,
    recurringBills: { count: 5, monthlyCents: 200_700 },
    overdueBills: [],
    next30Bills: [
      { name: "Rent", amountCents: 175_000, dateYmd: "2026-11-01" },
      { name: "Phone plan", amountCents: 5_500, dateYmd: "2026-10-20" },
    ],
    irregularBills: [{ name: "Car insurance", amountCents: 120_000, dateYmd: "2027-04-01", monthsAway: 6 }],
    hasSavingsTransferRule: false,
    goals: [
      { name: "Trip to Lisbon", currency: "CAD", remainingCents: 250_000, targetYmd: "2027-06-01", monthsLeft: 8, monthlyNeededCents: 31_250, status: "needs" },
      { name: "New laptop", currency: "CAD", remainingCents: 90_000, targetYmd: "2026-12-01", monthsLeft: 2, monthlyNeededCents: 45_000, status: "behind" },
      { name: "Done goal", currency: "CAD", remainingCents: 0, targetYmd: null, monthsLeft: null, monthlyNeededCents: null, status: "reached" },
    ],
    room: [{ accountType: "TFSA", year: 2026, remainingCents: 400_000, penaltyExcessCents: 0 }],
    staleBalances: ["Car Loan"],
    hasRetirementAccount: true,
    reviewQueueCount: 3,
    ...overrides,
  };
}

const plan = (facts: PlanFacts, range: ActionPlan["range"] = 24): ActionPlan => ({
  mode: "filled",
  currency: "CAD",
  todayYmd: facts.todayYmd,
  range,
  facts,
  steps: buildActionPlan(facts, fmt),
});

describe("plan parameters", () => {
  it("reads the range, defaulting to everything", () => {
    expect(parsePlanRange("3")).toBe(3);
    expect(parsePlanRange("12")).toBe(12);
    expect(parsePlanRange("7")).toBe(24);
    expect(parsePlanRange(null)).toBe(24);
  });

  it("puts a step in the horizon its length reaches", () => {
    expect([1, 3, 4, 6, 7, 12, 13, 40].map(horizonFor)).toEqual([3, 3, 6, 6, 12, 12, 24, 24]);
  });
});

describe("monthly averages", () => {
  const months = ["2026-07", "2026-08", "2026-09"];
  it("averages from the first month with activity, with spending by category", () => {
    const avg = monthlyAverages(
      [
        tx("2026-08-01", "Pay", 300_000, { type: "INCOME", categoryId: "pay", categoryName: "Salary" }),
        tx("2026-08-03", "Grocer", 50_000, { categoryId: "groc", categoryName: "Groceries" }),
        tx("2026-09-01", "Pay", 300_000, { type: "INCOME", categoryId: "pay", categoryName: "Salary" }),
        tx("2026-09-03", "Rent", 350_000, { categoryId: "rent", categoryName: "Rent" }),
        tx("2026-09-04", "Grocer refund", -10_000, { categoryId: "groc", categoryName: "Groceries" }),
        // The month still running is not one of `months`.
        tx("2026-10-01", "Pay", 999_999, { type: "INCOME", categoryId: "pay", categoryName: "Salary" }),
      ],
      months,
      null,
    );
    expect(avg.months).toEqual(["2026-08", "2026-09"]);
    expect(avg.incomeCents).toBe(300_000);
    expect(avg.spendingCents).toBe(195_000);
    expect(avg.savedCents).toBe(105_000);
    expect(avg.monthsInRed).toBe(1);
    expect(avg.categories).toEqual([
      { categoryId: "rent", name: "Rent", avgCents: 175_000 },
      { categoryId: "groc", name: "Groceries", avgCents: 20_000 },
    ]);
  });

  it("takes saving from transfers when accounts count as savings", () => {
    const avg = monthlyAverages(
      [tx("2026-09-01", "Pay", 300_000, { type: "INCOME", categoryId: "pay", categoryName: "Salary" })],
      months,
      new Map([["2026-09", 40_000]]),
    );
    expect(avg.savedCents).toBe(40_000);
  });
});

describe("the plan", () => {
  it("turns the user's figures into steps with reasons", () => {
    const steps = buildActionPlan(sampleFacts(), fmt);
    const find = (title: string) => steps.find((s) => s.title.includes(title));

    // $4,500 against $4,000 a month: past the starter fund, short of three months.
    expect(find("starter emergency fund")).toMatchObject({ done: true, horizon: 3 });
    const three = find("emergency fund to 3 months")!;
    expect(three).toMatchObject({ done: false, amountCents: 1_200_000 });
    // $7,500 to go at $1,300 a month (income less spending): 6 months, so the 6-month list.
    expect(three.horizon).toBe(6);
    expect(three.detail).toContain("$7,500.00 to go");
    expect(three.detail).toContain("about 6 months");
    // Six months is $24,000: $19,500 more at that pace is 15 months, past the year.
    expect(find("emergency fund to 6 months")).toMatchObject({ horizon: 24, done: false });

    // $1,200 on a card at $1,300 a month clears in one month.
    expect(find("Pay off Visa")).toMatchObject({ horizon: 3, amountCents: 120_000 });
    expect(find("Car Loan ahead of schedule")).toMatchObject({ horizon: 24 });
    expect(find("Set aside $200.00 a month")?.detail).toContain("Car insurance ($1,200.00)");
    expect(find("Set budgets you can keep")?.detail).toContain("Dining went over");
    expect(find("Add a budget for Rent")).toBeDefined();
    expect(find("Raise your savings to 20%")).toMatchObject({ horizon: 6, amountCents: 106_000, per: "month" });
    expect(find("Get New laptop back on track")).toMatchObject({ horizon: 3 });
    expect(find("Reach Trip to Lisbon")).toMatchObject({ horizon: 12, byYmd: "2027-06-01" });
    expect(steps.some((s) => s.title.includes("Done goal"))).toBe(false);
    // TFSA room carries forward: worth using this year, never lost.
    expect(find("Use TFSA room")).toMatchObject({ horizon: 12, amountCents: 400_000, byYmd: null });
    expect(find("Review 3 bank rows")).toBeDefined();
    expect(find("Update the balance for Car Loan")).toBeDefined();
    expect(find("Automate saving")).toBeDefined();
    // Has a TFSA, so no "start saving for retirement".
    expect(find("retirement")).toBeUndefined();
  });

  it("leads with closing a shortfall and keeps the plan's order", () => {
    const steps = buildActionPlan(sampleFacts({ avgSpendingCents: 600_000, avgSavedCents: -70_000, emergencyFundCents: 10_000 }), fmt);
    expect(nextSteps(steps).map((s) => s.title)).toEqual([
      "Close the gap of $700.00 a month",
      "Save a starter emergency fund of one month's spending",
      "Pay off Visa: $1,200.00",
    ]);
    // With nothing left over there is no pace to estimate from.
    expect(steps.find((s) => s.title.startsWith("Save a starter"))!.detail).not.toContain("months.");
    const horizons = steps.map((s) => s.horizon);
    expect(horizons).toEqual([...horizons].sort((a, b) => a - b));
  });

  it("flags a taxed over-contribution first", () => {
    const steps = buildActionPlan(sampleFacts({ room: [{ accountType: "RRSP", year: 2026, remainingCents: -300_000, penaltyExcessCents: 100_000 }] }), fmt);
    expect(nextSteps(steps)[0].title).toBe("Withdraw the RRSP over-contribution of $1,000.00");
  });

  it("asks for balances when there are none, and suggests retirement saving without an account for it", () => {
    const steps = buildActionPlan(sampleFacts({ emergencyFundCents: null, hasRetirementAccount: false }), fmt);
    expect(steps.find((s) => s.area === "Emergency fund")!.title).toBe("Record your chequing and savings balances");
    expect(steps.find((s) => s.area === "Retirement")!.detail).toContain("$530.00 to $795.00 a month");
  });

  it("limits the printed lists to the chosen range", () => {
    const p = plan(sampleFacts(), 6);
    expect(stepsInRange(p).every((s) => s.horizon <= 6)).toBe(true);
    expect(stepsInRange(p).length).toBeLessThan(p.steps.length);
  });
});

describe("the printed plan", () => {
  it("prints the user's steps, ticked where done, and stays within the range", async () => {
    const text = (await pdfPageTexts(await renderActionPlanPdf(plan(sampleFacts(), 6), "Alex Demo"))).join("\n");
    expect(text).toContain("Financial action plan");
    expect(text).toContain("Alex Demo");
    expect(text).toContain("Start here");
    expect(text).toContain("Next 3 months");
    expect(text).toContain("In 3 to 6 months");
    expect(text).not.toContain("In 6 to 12 months");
    expect(text).toContain("Pay off Visa: $1,200.00");
    expect(text).toContain("62 / 100");
  });

  it("prints a blank plan with nothing of the user's", async () => {
    const blank: ActionPlan = { mode: "blank", currency: "CAD", todayYmd: "2026-10-14", range: 24, facts: null, steps: blankPlanSteps() };
    const pages = await pdfPageTexts(await renderActionPlanPdf(blank, null));
    const text = pages.join("\n");
    expect(text).toContain("Where I am today");
    expect(text).toContain("In 1 to 2 years and beyond");
    expect(text).toContain("Save a starter emergency fund");
    expect(pages.length).toBeLessThanOrEqual(2);
  });

  it("writes the same steps to CSV", () => {
    const csv = actionPlanCsv(plan(sampleFacts(), 3));
    expect(csv.split("\r\n")[0]).toBe("When,Done,Area,Step,Why,Amount,Per,By");
    expect(csv).toContain('Next 3 months,,Debt,"Pay off Visa: $1,200.00"');
    expect(csv).toMatch(/Next 3 months,Yes,Emergency fund,Save a starter emergency fund/);
    expect(csv).not.toContain("In 3 to 6 months");
  });
});

describe("cards paid in full", () => {
  it("tells a card cleared each statement from one carrying a balance", () => {
    expect(paidInFull({ balanceCents: 90_000, recentChargesCents: 140_000 })).toBe(true);
    expect(paidInFull({ balanceCents: 140_000, recentChargesCents: 140_000 })).toBe(true);
    expect(paidInFull({ balanceCents: 150_000, recentChargesCents: 140_000 })).toBe(false);
    // Nothing charged to go by: the balance is taken as debt.
    expect(paidInFull({ balanceCents: 5_000, recentChargesCents: 0 })).toBe(false);
  });

  it("does not ask to pay off a card that is cleared every month", () => {
    const facts = sampleFacts({ cards: [{ name: "Visa", balanceCents: 120_000, recentChargesCents: 180_000 }], loans: [] });
    const steps = buildActionPlan(facts, fmt);
    expect(steps.some((s) => s.title.startsWith("Pay off"))).toBe(false);
    expect(steps.some((s) => s.title.includes("interest rate and minimum"))).toBe(false);
    expect(steps.find((s) => s.title === "Pay Visa in full each month")).toMatchObject({ done: true, horizon: 3 });
    expect(carriedCards(facts)).toEqual([]);
  });

  it("keeps a carried card as debt beside one paid in full", async () => {
    const facts = sampleFacts({
      cards: [
        { name: "Visa", balanceCents: 120_000, recentChargesCents: 180_000 },
        { name: "Store card", balanceCents: 250_000, recentChargesCents: 10_000 },
      ],
      loans: [],
    });
    const steps = buildActionPlan(facts, fmt);
    expect(steps.find((s) => s.title.startsWith("Pay off"))!.title).toBe("Pay off Store card: $2,500.00");
    expect(steps.find((s) => s.title === "Pay Visa in full each month")?.done).toBe(true);
    // The tile counts only what is carried.
    const text = (await pdfPageTexts(await renderActionPlanPdf(plan(facts), null))).join("\n");
    expect(text).toContain("1 carried");
    expect(text).toContain("$2,500.00");
  });
});

describe("months of cover", () => {
  it("rounds down, so a fund just short of a tier never reads as reaching it", () => {
    expect(monthsText(5.98)).toBe("5.9 months");
    expect(monthsText(6)).toBe("6.0 months");
  });
});
