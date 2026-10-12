import { describe, expect, it } from "vitest";
import { tx } from "@/lib/insights/test-fixtures";
import {
  computeFinancialScore,
  emergencyFundCents,
  isEmergencyFundAccount,
  monthlyRecurringCents,
  scoreBand,
  type FinancialScoreInput,
} from "./financial-score";

const TODAY = "2026-10-07";
const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const income = (date: string, cents: number) => tx(date, "Payroll", cents, { type: "INCOME", categoryId: "cat-salary", categoryName: "Salary" });
const expense = (date: string, cents: number, categoryName = "Groceries") =>
  tx(date, "Shop", cents, { categoryId: `cat-${categoryName}`, categoryName });

/** Pay and spending on the 5th of each of the six full months before October 2026. */
function steadyMonths(incomeCents: number, spendCents: number | number[]) {
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  return months.flatMap((ym, i) => [
    income(`${ym}-05`, incomeCents),
    expense(`${ym}-05`, Array.isArray(spendCents) ? spendCents[i] : spendCents),
  ]);
}

function score(overrides: Partial<FinancialScoreInput>) {
  return computeFinancialScore({ txs: [], budgets: [], recurring: [], todayYmd: TODAY, formatCents: fmt, ...overrides });
}

function scored(overrides: Partial<FinancialScoreInput>) {
  const result = score(overrides);
  if (result.status !== "scored") throw new Error(`expected a score, got: ${result.reason}`);
  return result;
}

describe("computeFinancialScore", () => {
  it("needs a full month with income before it scores", () => {
    expect(score({ txs: [] }).status).toBe("insufficient");
    // Only this month, which is still running.
    expect(score({ txs: [income("2026-10-02", 500_000)] }).status).toBe("insufficient");
    // Spending but no income to measure it against.
    expect(score({ txs: [expense("2026-09-02", 50_000)] }).status).toBe("insufficient");
  });

  it("measures the savings rate by what moved into savings accounts when any are marked", () => {
    const txs = steadyMonths(500_000, 300_000);
    // Left over is 40% of income, but only 10% actually moved into savings.
    const toSavingsByMonth = new Map(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((ym) => [ym, 50_000]));
    const marked = scored({ txs, toSavingsByMonth }).factors.find((f) => f.id === "savings")!;
    expect(marked.detail).toBe("10% of income moved to savings");
    expect(marked.score).toBe(65);
    expect(scored({ txs, toSavingsByMonth }).suggestions).toContain(
      "Moving about $500.00 more a month into savings would bring your savings rate to 20%.",
    );

    const unmarked = scored({ txs, toSavingsByMonth: null }).factors.find((f) => f.id === "savings")!;
    expect(unmarked.detail).toBe("40% of income saved");
  });

  it("scores a household saving 30% steadily as strong", () => {
    const result = scored({ txs: steadyMonths(500_000, 350_000) });
    expect(result.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    const byId = Object.fromEntries(result.factors.map((f) => [f.id, f]));
    expect(byId.savings.score).toBe(100);
    expect(byId.consistency.score).toBe(100);
    expect(byId.trend.score).toBe(80);
    expect(result.band).toBe("Strong");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("scores the emergency fund in months of average spending", () => {
    const txs = steadyMonths(500_000, 300_000);
    const fund = (cents: number) => scored({ txs, emergencyFundCents: cents }).factors.find((f) => f.id === "emergency")!;

    expect(fund(900_000).score).toBe(90);
    expect(fund(900_000).detail).toBe("3.0 months of spending in chequing and savings");
    expect(fund(900_000).suggestion).toBeNull();
    expect(fund(1_800_000).score).toBe(100);
    expect(fund(300_000).score).toBe(40);
    expect(fund(300_000).detail).toBe("1.0 month of spending in chequing and savings");
    expect(fund(0).score).toBe(0);
    expect(fund(-20_000).detail).toBe("Chequing and savings are overdrawn");

    const thin = scored({ txs, emergencyFundCents: 360_000 });
    expect(thin.suggestions).toContain(
      "Chequing and savings cover 1.2 months of spending. Setting aside about $5400.00 would build a 3-month emergency fund.",
    );
    expect(scored({ txs, emergencyFundCents: -1 }).suggestions).toContain(
      "Chequing and savings hold nothing to fall back on. Setting aside about $9000.01 would build a 3-month emergency fund.",
    );
  });

  it("leaves the emergency fund out without balances, and weighs it in with them", () => {
    const txs = steadyMonths(500_000, 300_000);
    const without = scored({ txs });
    expect(without.factors.map((f) => f.id)).not.toContain("emergency");
    expect(without.omitted).toContainEqual({ label: "Emergency fund", reason: "no chequing or savings balances yet" });

    const withFund = scored({ txs, emergencyFundCents: 0 });
    expect(withFund.omitted.map((o) => o.label)).not.toContain("Emergency fund");
    expect(withFund.factors.find((f) => f.id === "emergency")!.weight).toBeCloseTo(20 / 80);
    expect(withFund.score).toBeLessThan(without.score);
  });

  it("drops factors it has no data for and reweights the rest", () => {
    const result = scored({ txs: steadyMonths(500_000, 350_000) });
    expect(result.factors.map((f) => f.id).sort()).toEqual(["consistency", "savings", "trend"]);
    expect(result.omitted.map((o) => o.label).sort()).toEqual(["Budgets kept", "Emergency fund", "Fixed bills"]);
    expect(result.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });

  it("only counts months from the first recorded activity", () => {
    const result = scored({ txs: [income("2026-08-01", 400_000), expense("2026-08-03", 300_000), income("2026-09-01", 400_000)] });
    expect(result.months).toEqual(["2026-08", "2026-09"]);
    expect(result.omitted.map((o) => o.label)).toContain("Spending trend");
    const consistency = result.factors.find((f) => f.id === "consistency")!;
    expect(consistency.detail).toBe("2 of 2 months ended with money left over");
  });

  it("ignores transfers and this month's rows", () => {
    const base = steadyMonths(500_000, 350_000);
    const noisy = [
      ...base,
      tx("2026-09-10", "Card payment", 900_000, { type: "TRANSFER" }),
      expense("2026-10-02", 900_000),
    ];
    expect(scored({ txs: noisy }).score).toBe(scored({ txs: base }).score);
  });

  it("flags overspending and suggests how much to cut for a 20% savings rate", () => {
    const result = scored({ txs: steadyMonths(400_000, 420_000) });
    const savings = result.factors.find((f) => f.id === "savings")!;
    expect(savings.score).toBeLessThan(35);
    expect(savings.detail).toBe("Spent 5% more than earned");
    // 20% of $4,000 is $800 left over; they are $200 short, so $1,000 less a month.
    expect(savings.suggestion).toContain("$1000.00 less a month");
    expect(result.factors.find((f) => f.id === "consistency")!.score).toBe(0);
    expect(result.band).toBe("At risk");
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("scores recurring bills against average income and names the largest", () => {
    const result = scored({
      txs: steadyMonths(400_000, 300_000),
      recurring: [
        { name: "Rent", type: "EXPENSE", amountCents: 200_000, cadence: "MONTHLY", enabled: true, endDate: null },
        { name: "Insurance", type: "EXPENSE", amountCents: 120_000, cadence: "YEARLY", enabled: true, endDate: null },
        { name: "Old gym", type: "EXPENSE", amountCents: 50_000, cadence: "MONTHLY", enabled: false, endDate: null },
        { name: "Pay", type: "INCOME", amountCents: 400_000, cadence: "MONTHLY", enabled: true, endDate: null },
      ],
    });
    const bills = result.factors.find((f) => f.id === "bills")!;
    // $2,000 + $100 a month on $4,000 income.
    expect(bills.detail).toBe("53% of income goes to recurring bills");
    expect(bills.score).toBeLessThan(70);
    expect(bills.suggestion).toContain("Rent ($2000.00/mo)");
    expect(bills.suggestion).not.toContain("Old gym");
  });

  it("counts budgets kept in the last three months, with part credit just over", () => {
    const groceries = (ym: string, cents: number) => expense(`${ym}-10`, cents, "Groceries");
    const txs = [
      ...steadyMonths(500_000, 0),
      groceries("2026-07", 40_000), // within
      groceries("2026-08", 52_000), // 4% over: half credit
      groceries("2026-09", 70_000), // well over
    ];
    const result = scored({
      txs,
      budgets: [{ categoryId: "cat-Groceries", categoryName: "Groceries", periodMonth: "2026-01", limitCents: 50_000 }],
    });
    const budgets = result.factors.find((f) => f.id === "budgets")!;
    expect(budgets.score).toBe(50);
    expect(budgets.detail).toBe("1 of 3 monthly budgets kept in the last 3 months");
    expect(budgets.suggestion).toContain("Groceries went over budget in 2 of the last 3 months");
  });

  it("uses the budget in force each month", () => {
    const txs = [...steadyMonths(500_000, 0), expense("2026-09-10", 60_000, "Groceries")];
    const result = scored({
      txs,
      budgets: [
        { categoryId: "cat-Groceries", categoryName: "Groceries", periodMonth: "2026-01", limitCents: 50_000 },
        { categoryId: "cat-Groceries", categoryName: "Groceries", periodMonth: "2026-09", limitCents: 70_000 },
      ],
    });
    expect(result.factors.find((f) => f.id === "budgets")!.score).toBe(100);
  });

  it("marks rising spending down and names the category behind it", () => {
    const txs = [
      ...steadyMonths(600_000, [300_000, 300_000, 300_000, 300_000, 300_000, 300_000]),
      expense("2026-07-12", 90_000, "Dining"),
      expense("2026-08-12", 90_000, "Dining"),
      expense("2026-09-12", 90_000, "Dining"),
    ];
    const trend = scored({ txs }).factors.find((f) => f.id === "trend")!;
    expect(trend.detail).toBe("Spending up 30% on the 3 months before");
    expect(trend.score).toBe(0);
    expect(trend.suggestion).toContain("The biggest rise is Dining, up $900.00 a month");
  });

  it("orders suggestions weakest first and leaves strong factors out", () => {
    const txs = [
      ...steadyMonths(400_000, [300_000, 300_000, 300_000, 300_000, 300_000, 450_000]),
    ];
    const result = scored({ txs });
    const weakest = [...result.factors].filter((f) => f.suggestion && f.score < 80).sort((a, b) => a.score - b.score);
    expect(result.suggestions).toEqual(weakest.map((f) => f.suggestion));
    for (const f of result.factors.filter((f) => f.score >= 80)) expect(result.suggestions).not.toContain(f.suggestion);
  });
});

describe("scoreBand", () => {
  it("maps scores to labels", () => {
    expect([95, 80, 79, 65, 50, 35, 34, 0].map(scoreBand)).toEqual([
      "Strong",
      "Strong",
      "Good",
      "Good",
      "Fair",
      "Needs work",
      "At risk",
      "At risk",
    ]);
  });
});

describe("monthlyRecurringCents", () => {
  it("puts every cadence on a monthly footing and skips ended rules", () => {
    const rule = (name: string, cadence: "WEEKLY" | "BIWEEKLY" | "QUARTERLY", endDate: Date | null = null) => ({
      name,
      type: "EXPENSE" as const,
      amountCents: 1_200,
      cadence,
      enabled: true,
      endDate,
    });
    expect(
      monthlyRecurringCents(
        [rule("w", "WEEKLY"), rule("b", "BIWEEKLY"), rule("q", "QUARTERLY"), rule("ended", "WEEKLY", new Date("2026-09-30"))],
        "EXPENSE",
        TODAY,
      ),
    ).toEqual([
      { name: "w", cents: 5_200 },
      { name: "b", cents: 2_600 },
      { name: "q", cents: 400 },
    ]);
  });
});

describe("emergency fund accounts", () => {
  const account = (type: string, extra: Partial<{ countsAsSavings: boolean; archived: boolean; currency: string; latestCents: number | null }> = {}) => ({
    type,
    countsAsSavings: false,
    archived: false,
    currency: "CAD",
    latestCents: 100_000,
    ...extra,
  });

  it("counts spendable accounts and marked savings, never an RRSP or what is owed", () => {
    expect(isEmergencyFundAccount(account("CHEQUING"))).toBe(true);
    expect(isEmergencyFundAccount(account("SAVINGS"))).toBe(true);
    expect(isEmergencyFundAccount(account("CASH"))).toBe(true);
    expect(isEmergencyFundAccount(account("TFSA"))).toBe(false);
    expect(isEmergencyFundAccount(account("TFSA", { countsAsSavings: true }))).toBe(true);
    expect(isEmergencyFundAccount(account("RRSP", { countsAsSavings: true }))).toBe(false);
    expect(isEmergencyFundAccount(account("CREDIT_CARD", { countsAsSavings: true }))).toBe(false);
    expect(isEmergencyFundAccount(account("PROPERTY", { countsAsSavings: true }))).toBe(false);
  });

  it("totals latest balances in the score's currency, and is null with none", () => {
    expect(
      emergencyFundCents(
        [
          account("CHEQUING", { latestCents: 250_000 }),
          account("SAVINGS", { latestCents: 500_000 }),
          account("SAVINGS", { latestCents: 999_000, currency: "USD" }),
          account("SAVINGS", { latestCents: 999_000, archived: true }),
          account("RRSP", { latestCents: 999_000, countsAsSavings: true }),
          account("CHEQUING", { latestCents: null }),
        ],
        "CAD",
      ),
    ).toBe(750_000);
    expect(emergencyFundCents([account("CHEQUING", { latestCents: null }), account("RRSP")], "CAD")).toBeNull();
  });
});
