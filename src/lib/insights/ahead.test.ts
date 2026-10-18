import { describe, expect, it } from "vitest";
import type { ProjectedAccount, ProjectedBalances } from "@/lib/projected-balances";
import { detectAhead, type AheadInput } from "./ahead";
import { NOW } from "./test-fixtures";
import type { InsightRecurringRule } from "./types";
import { moneyFormatter } from "./util";

const fmt = moneyFormatter();
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const run = (input: Partial<AheadInput>) => detectAhead({ projection: null, budgets: null, rules: [], now: NOW, fmt, ...input });

function projection(...accounts: Array<Partial<ProjectedAccount>>): ProjectedBalances {
  return {
    netCents: [],
    rulesLeftOut: 0,
    accounts: accounts.map((a) => ({
      accountId: "chq",
      name: "Chequing",
      liability: false,
      currentCents: 50_000,
      asOf: day("2026-09-24"),
      projectedCents: [],
      belowZero: null,
      ...a,
    })),
  };
}

describe("low balance ahead", () => {
  it("warns when the forecast takes an account below zero, naming the bill that does it", () => {
    const [insight] = run({
      projection: projection({ belowZero: { date: day("2026-10-01"), cause: "Rent", lowestCents: -120_000 } }),
    });
    expect(insight).toMatchObject({ key: "ahead:low-balance:chq:2026-10-01", section: "ahead", severity: "high" });
    expect(insight.title).toBe("Chequing could drop below $0.00 on Oct 1");
    expect(insight.body).toContain("when Rent is due");
    expect(insight.body).toContain("as low as -$1,200");
  });

  it("is less pressing further out, and says nothing from a stale reading or about a card", () => {
    const later = { belowZero: { date: day("2026-11-20"), cause: null, lowestCents: -100 } };
    expect(run({ projection: projection(later) })[0].severity).toBe("medium");
    expect(run({ projection: projection({ ...later, asOf: day("2026-08-01") }) })).toEqual([]);
    expect(run({ projection: projection({ ...later, liability: true }) })).toEqual([]);
    expect(run({ projection: projection({}) })).toEqual([]);
  });
});

describe("budget pace", () => {
  // 25 of 30 days into September.
  const row = (spentCents: number) => [{ categoryId: "dining", categoryName: "Dining", spentCents, limitCents: 30_000 }];

  it("says a budget is over, on pace to go over, or nearly used, the most serious only", () => {
    expect(run({ budgets: row(34_500) }).map((i) => [i.key, i.severity, i.title])).toEqual([
      ["ahead:budget:dining:2026-09:over", "high", "Dining is $45.00 over budget"],
    ]);
    const [pace] = run({ budgets: row(29_000) });
    expect([pace.key, pace.severity, pace.title]).toEqual([
      "ahead:budget:dining:2026-09:pace",
      "medium",
      // $290 in 25 days of 30 ends the month near $348.
      "Dining is on pace to go $48.00 over budget",
    ]);
    expect(pace.body).toContain("5 days left in September");
    // On pace for the month, but most of it gone.
    expect(run({ budgets: row(25_000) }).map((i) => [i.key, i.severity, i.title])).toEqual([
      ["ahead:budget:dining:2026-09:nearly", "low", "Dining is 83% used"],
    ]);
  });

  it("says nothing of a budget on track", () => {
    expect(run({ budgets: row(10_000) })).toEqual([]);
  });
});

describe("yearly renewals", () => {
  const rule = (overrides: Partial<InsightRecurringRule>): InsightRecurringRule => ({
    id: "r1",
    name: "Costco membership",
    type: "EXPENSE",
    amountCents: 13_000,
    cadence: "YEARLY",
    enabled: true,
    categoryId: "c",
    nextExpectedDate: day("2026-10-05"),
    ...overrides,
  });

  it("raises a yearly charge due within a month", () => {
    const [insight] = run({ rules: [rule({})] });
    expect(insight).toMatchObject({ key: "ahead:renewal:r1:2026-10-05", severity: "medium", annualCents: 13_000 });
    expect(insight.title).toBe("Costco membership is due in 10 days");
    expect(insight.body).toContain("$130 on Oct 5, once a year");
  });

  it("leaves out monthly, overdue, far-off, disabled and income rules", () => {
    expect(
      run({
        rules: [
          rule({ cadence: "MONTHLY" }),
          rule({ nextExpectedDate: day("2026-09-20") }),
          rule({ nextExpectedDate: day("2026-12-01") }),
          rule({ enabled: false }),
          rule({ type: "INCOME" }),
        ],
      }),
    ).toEqual([]);
  });
});
