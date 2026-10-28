import { describe, expect, it } from "vitest";
import { forecastRecurringOccurrences } from "./bills-forecast";
import { dateFromYmd } from "./date-only";
import { matchPlannedTransactions, plannedAsForecastRules, type EntryToMatch, type PlanToMatch } from "./planned-transactions";
import { computeSafeToSpend } from "./safe-to-spend";

const saved = new Date("2026-10-01T12:00:00Z");
const later = new Date("2026-10-20T12:00:00Z");

const plan = (over: Partial<PlanToMatch> = {}): PlanToMatch => ({
  id: "plan",
  type: "EXPENSE",
  accountId: "visa",
  categoryId: "car",
  amountCents: 80_000,
  dateYmd: "2026-10-15",
  createdAt: saved,
  ...over,
});
const entry = (over: Partial<EntryToMatch> = {}): EntryToMatch => ({
  id: "entry",
  type: "EXPENSE",
  accountId: "visa",
  categoryId: "car",
  amountCents: 80_000,
  dateYmd: "2026-10-15",
  createdAt: later,
  ...over,
});

describe("matchPlannedTransactions", () => {
  it("settles a plan with an entry in its category that cost a little less", () => {
    expect(matchPlannedTransactions([plan()], [entry({ amountCents: 76_000, dateYmd: "2026-10-18" })])).toEqual(
      new Map([["plan", "entry"]]),
    );
  });

  it("takes an exact amount in another category, but not an approximate one", () => {
    expect(matchPlannedTransactions([plan()], [entry({ categoryId: "other" })]).get("plan")).toBe("entry");
    expect(matchPlannedTransactions([plan()], [entry({ categoryId: "other", amountCents: 79_000 })]).size).toBe(0);
  });

  it("leaves a plan alone for an entry outside the window, on another account, or recorded before it", () => {
    for (const other of [
      entry({ dateYmd: "2026-10-07" }),
      entry({ dateYmd: "2026-10-30" }),
      entry({ accountId: "chequing" }),
      entry({ type: "INCOME" }),
      entry({ amountCents: 70_000 }),
      entry({ createdAt: new Date("2026-09-30T00:00:00Z") }),
    ]) {
      expect(matchPlannedTransactions([plan()], [other]).size).toBe(0);
    }
  });

  it("gives each entry to one plan, the best pair first", () => {
    const plans = [plan({ id: "near", amountCents: 79_000 }), plan({ id: "exact" })];
    const entries = [entry({ id: "a" }), entry({ id: "b", amountCents: 78_000 })];
    expect(matchPlannedTransactions(plans, entries)).toEqual(
      new Map([
        ["exact", "a"],
        ["near", "b"],
      ]),
    );
  });
});

describe("plans in the forecasts", () => {
  const plans = plannedAsForecastRules([
    { id: "repair", type: "EXPENSE" as const, amountCents: 80_000, date: dateFromYmd("2026-10-20") },
    { id: "refund", type: "INCOME" as const, amountCents: 50_000, date: dateFromYmd("2026-11-05") },
    { id: "late", type: "EXPENSE" as const, amountCents: 10_000, date: dateFromYmd("2026-10-02") },
    { id: "gone", type: "EXPENSE" as const, amountCents: 10_000, date: dateFromYmd("2026-09-20") },
  ]);

  it("lists each plan once, overdue once its date has passed this month, and not from an earlier month", () => {
    const forecast = forecastRecurringOccurrences(plans, { todayYmd: "2026-10-10", currentYm: "2026-10", days: 90 });
    expect(forecast.occurrences.map((o) => [o.rule.id, o.overdue])).toEqual([
      ["late", true],
      ["repair", false],
      ["refund", false],
    ]);
    expect(forecast.expenseCents).toBe(90_000);
    expect(forecast.incomeCents).toBe(50_000);
  });

  it("takes this month's plans out of safe to spend", () => {
    const forecast = forecastRecurringOccurrences(plans, { todayYmd: "2026-10-10", currentYm: "2026-10", days: 22 });
    const safe = computeSafeToSpend({
      todayYmd: "2026-10-10",
      incomeReceivedCents: 300_000,
      spentCents: 0,
      occurrences: forecast.occurrences.map((o) => ({
        type: o.rule.type,
        amountCents: o.rule.amountCents,
        categoryId: "car",
        dateYmd: o.date.toISOString().slice(0, 10),
      })),
      budgets: [],
      goalContributionsCents: [],
    });
    expect(safe.billsDueCents).toBe(90_000);
    expect(safe.safeCents).toBe(210_000);
  });
});
