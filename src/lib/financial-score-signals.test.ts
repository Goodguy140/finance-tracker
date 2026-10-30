import { describe, expect, it } from "vitest";
import { tx } from "@/lib/insights/test-fixtures";
import {
  carriedCents,
  computeFinancialScore,
  guessSpendingRole,
  loanPaymentCheck,
  savingsMultipleFor,
  type FinancialScoreInput,
  type ScoreCard,
  type ScoreLoan,
} from "./financial-score";

const TODAY = "2026-10-07";
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const income = (date: string, cents: number) => tx(date, "Payroll", cents, { type: "INCOME", categoryId: "cat-salary", categoryName: "Salary" });
const expense = (date: string, cents: number, categoryName = "Groceries", extra: Parameters<typeof tx>[3] = {}) =>
  tx(date, "Shop", cents, { categoryId: `cat-${categoryName}`, categoryName, ...extra });

function steadyMonths(incomeCents: number | number[], spendCents: number) {
  return MONTHS.flatMap((ym, i) => [
    income(`${ym}-05`, Array.isArray(incomeCents) ? incomeCents[i] : incomeCents),
    expense(`${ym}-05`, spendCents),
  ]);
}

function scored(overrides: Partial<FinancialScoreInput>) {
  const result = computeFinancialScore({
    txs: steadyMonths(500_000, 350_000),
    budgets: [],
    recurring: [],
    todayYmd: TODAY,
    formatCents: fmt,
    ...overrides,
  });
  if (result.status !== "scored") throw new Error(`expected a score, got: ${result.reason}`);
  return result;
}
const factor = (result: ReturnType<typeof scored>, id: string) => result.factors.find((f) => f.id === id);

const card = (overrides: Partial<ScoreCard> = {}): ScoreCard => ({
  accountId: "visa",
  name: "Visa",
  balanceCents: 150_000,
  recentChargesCents: 200_000,
  creditLimitCents: null,
  interestRateBps: null,
  minimumPaymentCents: null,
  history: [],
  ...overrides,
});

const loan = (overrides: Partial<ScoreLoan> = {}): ScoreLoan => ({
  accountId: "car",
  name: "Car loan",
  type: "LOAN",
  balanceCents: 1_200_000,
  interestRateBps: 700,
  minimumPaymentCents: 40_000,
  paymentsByMonth: new Map(MONTHS.map((ym) => [ym, 40_000])),
  recurringPaymentCents: 0,
  ...overrides,
});

describe("debt in the financial score", () => {
  it("leaves the Borrow pillar out when cards are paid off and loans are paid on schedule", () => {
    const result = scored({ cards: [card()], loans: [loan()] });
    expect(result.factors.map((f) => f.pillar)).not.toContain("borrow");
    expect(result.omitted).toContainEqual({ label: "Credit cards", reason: "paid off each month" });
    expect(result.omitted).toContainEqual({ label: "Loan payments", reason: "minimums paid" });
    // A loan paid on schedule is not counted as a commitment either.
    expect(factor(result, "bills")).toBeUndefined();
    const borrow = result.pillars.find((p) => p.id === "borrow")!;
    expect(borrow.score).toBeNull();
    expect(borrow.note).toBe("No debt counted: cards are paid off and loan minimums are met");
  });

  it("counts a card carrying a balance beyond its recent charges, with its utilization", () => {
    expect(carriedCents(card())).toBe(0);
    expect(carriedCents(card({ balanceCents: 500_000 }))).toBe(300_000);
    // No charges recorded: the whole balance is taken as carried.
    expect(carriedCents(card({ balanceCents: 500_000, recentChargesCents: 0 }))).toBe(500_000);

    const carriedCard = card({ balanceCents: 500_000, creditLimitCents: 1_000_000, interestRateBps: 2099, minimumPaymentCents: 15_000 });
    const result = scored({ cards: [carriedCard] });
    const cards = factor(result, "cards")!;
    expect(cards.pillar).toBe("borrow");
    expect(cards.detail).toBe("$3000.00 carried on Visa, 50% of its limit");
    // Carried is 60% of a month's income (≈46) and 50% utilization (40): about 43.
    expect(cards.score).toBe(43);
    expect(cards.suggestion).toContain("Visa carries about $3000.00 from month to month at 20.99%");
    expect(cards.suggestion).toContain("under 30%");
    // Its minimum now counts as a commitment.
    expect(factor(result, "bills")!.label).toBe("Bills and debt payments");
    // Interest on it is estimated from the rate.
    expect(factor(result, "fees")!.detail).toBe("About $87.46 a month in interest and fees, 1.7% of income");

    const growing = scored({ cards: [{ ...carriedCard, history: [300_000, 400_000, 500_000] }] });
    expect(factor(growing, "cards")!.score).toBe(28);
    expect(factor(growing, "cards")!.detail).toContain("and growing");
  });

  it("counts a loan only once its payments fall short of the minimum", () => {
    const short = new Map(MONTHS.map((ym) => [ym, ym >= "2026-08" ? 10_000 : 40_000]));
    expect(loanPaymentCheck(loan({ paymentsByMonth: short }), MONTHS.slice(-3))).toEqual({
      checks: 3,
      credit: 1,
      shortMonth: { ym: "2026-08", paidCents: 10_000 },
    });
    // Nothing seen paid at all: a missed payment can't be told from one paid some other way.
    expect(loanPaymentCheck(loan({ paymentsByMonth: new Map() }), MONTHS.slice(-3)).checks).toBe(0);
    // Months before the first payment seen are not judged.
    expect(loanPaymentCheck(loan({ paymentsByMonth: new Map([["2026-09", 40_000]]) }), MONTHS.slice(-3)).checks).toBe(1);

    const result = scored({ loans: [loan({ paymentsByMonth: short })] });
    const loans = factor(result, "loans")!;
    expect(loans.score).toBe(33);
    expect(loans.detail).toBe("Car loan got less than its minimum in 2 of the last 3 months");
    expect(loans.suggestion).toContain("Car loan's minimum is $400.00 a month, but $100.00 went to it in August.");
    expect(factor(result, "bills")!.detail).toBe("8% of income goes to recurring bills and debt payments");
  });

  it("counts a mortgage payment with the bills, as housing, unless a bill already covers it", () => {
    const mortgage = loan({ accountId: "home", name: "Mortgage", type: "MORTGAGE", balanceCents: 30_000_000, minimumPaymentCents: 180_000, paymentsByMonth: new Map(MONTHS.map((ym) => [ym, 180_000])) });
    const result = scored({ loans: [mortgage] });
    expect(factor(result, "bills")!.detail).toBe("36% of income goes to recurring bills and debt payments");
    expect(result.factors.map((f) => f.pillar)).not.toContain("borrow");

    const billed = scored({
      loans: [mortgage],
      recurring: [{ name: "House payment", categoryName: "Mortgage", type: "EXPENSE", amountCents: 180_000, cadence: "MONTHLY", enabled: true, endDate: null }],
    });
    expect(factor(billed, "bills")!.detail).toBe("36% of income goes to recurring bills");
  });

  it("scores fees, and caps the factor when one shows a missed payment", () => {
    const withFee = (title: string) => [...steadyMonths(500_000, 350_000), expense("2026-08-12", 4_800, "Bank fees", { title })];
    const monthly = factor(scored({ txs: withFee("Monthly account fee") }), "fees")!;
    expect(monthly.score).toBe(90);
    const nsf = factor(scored({ txs: withFee("NSF fee") }), "fees")!;
    expect(nsf.score).toBe(60);
    expect(nsf.suggestion).toBe(
      "NSF fee ($48.00 in August) is charged when a payment bounces or comes in late. A small buffer in chequing, or a reminder before each due date, avoids it.",
    );
    expect(scored({}).omitted).toContainEqual({ label: "Interest and fees", reason: "none paid" });
  });
});

describe("cash buffer and income stability", () => {
  it("replaces months in the black with the cash buffer when everyday balances are known", () => {
    const daily = 350_000 / (365.25 / 12);
    const lows = new Map(MONTHS.map((ym) => [ym, Math.round(daily * 10)]));
    const result = scored({ everydayLowsByMonth: lows });
    expect(factor(result, "consistency")).toBeUndefined();
    const buffer = factor(result, "buffer")!;
    expect(buffer.detail).toBe("Everyday accounts got down to about 10 days of spending");
    expect(buffer.score).toBe(41);
    expect(result.monthsInBlack).toEqual({ positive: 6, total: 6 });

    expect(factor(scored({ everydayLowsByMonth: new Map(MONTHS.map((ym) => [ym, -5_000])) }), "buffer")!.score).toBe(0);
    expect(factor(scored({ everydayLowsByMonth: null }), "consistency")).toBeDefined();
  });

  it("aims for six months of emergency fund when income swings", () => {
    const steady = scored({ emergencyFundCents: 1_050_000 });
    expect(steady.emergencyTargetMonths).toBe(3);
    expect(factor(steady, "emergency")!.score).toBe(90);

    const swinging = scored({ txs: steadyMonths([200_000, 800_000, 300_000, 900_000, 250_000, 550_000], 350_000), emergencyFundCents: 1_050_000 });
    expect(swinging.emergencyTargetMonths).toBe(6);
    expect(factor(swinging, "emergency")!.score).toBe(55);
    expect(factor(swinging, "emergency")!.suggestion).toContain("6-month emergency fund, the aim when income changes this much");
  });
});

describe("yearly budgets", () => {
  it("counts each yearly budget once for the year so far", () => {
    const txs = [...steadyMonths(500_000, 350_000), expense("2026-02-10", 90_000, "Insurance"), expense("2026-09-10", 40_000, "Insurance")];
    const yearlyBudgets = [{ categoryId: "cat-Insurance", categoryName: "Insurance", year: 2026, limitCents: 100_000 }];
    const kept = factor(scored({ txs, yearlyBudgets: [{ ...yearlyBudgets[0], limitCents: 150_000 }] }), "budgets")!;
    expect(kept.score).toBe(100);
    expect(kept.detail).toBe("1 of 1 budgets kept: monthly over the last 3 months, yearly so far this year");

    const over = factor(scored({ txs, yearlyBudgets }), "budgets")!;
    expect(over.score).toBe(0);
    expect(over.suggestion).toBe("Insurance is already over its yearly budget for 2026. Raise the yearly limit, or hold back on it until January.");
    // A budget for a later year is not in force yet.
    expect(factor(scored({ txs, yearlyBudgets: [{ ...yearlyBudgets[0], year: 2027 }] }), "budgets")).toBeUndefined();
  });
});

describe("the Plan pillar", () => {
  it("scores net worth direction against a year's income", () => {
    const up = factor(scored({ netWorth: { startYm: "2026-04", startCents: 1_000_000, endCents: 1_300_000, biggestDrop: null } }), "networth")!;
    expect(up.score).toBe(100);
    expect(up.detail).toBe("Net worth up $3000.00 since April");
    const down = factor(
      scored({ netWorth: { startYm: "2026-04", startCents: 1_300_000, endCents: 1_000_000, biggestDrop: { name: "Savings", cents: 250_000 } } }),
      "networth",
    )!;
    expect(down.score).toBe(30);
    expect(down.suggestion).toContain("most of it in Savings (down $2500.00)");
  });

  it("scores the cash outlook from the first account going below zero", () => {
    expect(factor(scored({ outlook: { belowZero: null } }), "outlook")!.score).toBe(100);
    const dip = factor(scored({ outlook: { belowZero: { accountName: "Chequing", days: 14, dateLabel: "Oct 21", cause: "Rent" } } }), "outlook")!;
    expect(dip.score).toBe(25);
    expect(dip.suggestion).toContain("Chequing is on course to go below zero on Oct 21, when Rent comes out.");
    expect(scored({ outlook: null }).omitted).toContainEqual({ label: "Cash outlook", reason: "no balance read in the last month" });
  });

  it("scores dated savings goals on pace", () => {
    const result = scored({
      goals: [
        { name: "Trip", status: "on-track", monthlyNeededCents: 20_000 },
        { name: "Car", status: "behind", monthlyNeededCents: 50_000 },
        { name: "Someday", status: "open", monthlyNeededCents: null },
      ],
    });
    const goals = factor(result, "goals")!;
    expect(goals.score).toBe(50);
    expect(goals.detail).toBe("1 of 2 dated goals on pace");
    expect(goals.suggestion).toContain("Car is behind: it needs about $500.00 a month");
  });
});

describe("long-term savings", () => {
  it("scores contributions, and with an age the balance against a multiple of income", () => {
    expect(savingsMultipleFor(30)).toBe(1);
    expect(savingsMultipleFor(35)).toBe(2);

    const none = scored({ longTerm: { accountCount: 0, contributedCents: 0, investedCents: null, age: null } });
    expect(none.omitted).toContainEqual({ label: "Long-term savings", reason: "no TFSA, RRSP, FHSA or investment accounts" });

    // 10% of income in.
    const contributing = factor(scored({ longTerm: { accountCount: 1, contributedCents: 300_000, investedCents: 6_000_000, age: null } }), "longterm")!;
    expect(contributing.score).toBe(80);
    expect(contributing.detail).toBe("10% of income into long-term accounts");

    // At 35 the benchmark is 2× a year's $60,000 income; $60,000 saved is half of it.
    const withAge = factor(scored({ longTerm: { accountCount: 1, contributedCents: 300_000, investedCents: 6_000_000, age: 35 } }), "longterm")!;
    expect(withAge.score).toBe(65);
    expect(withAge.detail).toBe("10% of income into long-term accounts; they hold 1.0× a year's income (about 2.0× is typical at 35)");
    expect(withAge.pillar).toBe("save");
  });
});

describe("needs and wants", () => {
  it("guesses a category's role from its name or group", () => {
    expect(guessSpendingRole({ name: "Rent" })).toBe("NEED");
    expect(guessSpendingRole({ name: "Groceries" })).toBe("NEED");
    expect(guessSpendingRole({ name: "Dining" })).toBe("WANT");
    expect(guessSpendingRole({ name: "Phone plan", groupName: null })).toBe("NEED");
    expect(guessSpendingRole({ name: "Streaming", groupName: "Fun" })).toBe("WANT");
    expect(guessSpendingRole({ name: "Hydro bill", groupName: "Essentials" })).toBe("NEED");
  });

  it("splits income into needs, wants and saved", () => {
    const txs = MONTHS.flatMap((ym) => [income(`${ym}-05`, 500_000), expense(`${ym}-06`, 250_000, "Rent"), expense(`${ym}-07`, 100_000, "Dining")]);
    const result = scored({ txs, categoryRoles: new Map([["cat-Rent", "NEED"], ["cat-Dining", "WANT"]]) });
    expect(result.split).toEqual({ needs: 0.5, wants: 0.2, saved: 0.3 });
    expect(scored({ txs }).split).toBeNull();
  });
});

describe("pillars", () => {
  it("averages each pillar's factors by their weights", () => {
    const result = scored({ emergencyFundCents: 1_050_000, outlook: { belowZero: null } });
    const byId = Object.fromEntries(result.pillars.map((p) => [p.id, p]));
    expect(result.pillars.map((p) => p.id)).toEqual(["spend", "save", "borrow", "plan"]);
    expect(byId.save.score).toBe(90);
    expect(byId.plan.score).toBe(100);
    expect(byId.borrow.score).toBeNull();
    expect(result.pillars.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1);
  });
});
