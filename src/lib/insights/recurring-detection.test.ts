import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { classifyCadence, detectRecurringCandidates, recurringCandidateInsights, semiMonthlyScheduleOf } = await import(
  "./recurring-detection"
);
const { moneyFormatter } = await import("./util");

const fmt = moneyFormatter();

describe("classifyCadence", () => {
  it("maps a median gap to its band", () => {
    expect(classifyCadence([7, 7, 8, 6])?.band.cadence).toBe("WEEKLY");
    expect(classifyCadence([14, 14, 15])?.band.cadence).toBe("BIWEEKLY");
    expect(classifyCadence([31, 30, 31, 28])?.band.cadence).toBe("MONTHLY");
    expect(classifyCadence([92])?.band.cadence).toBe("QUARTERLY");
    expect(classifyCadence([365])?.band.cadence).toBe("YEARLY");
  });

  it("returns nothing for gaps between bands", () => {
    expect(classifyCadence([20, 21, 22])).toBeNull();
    expect(classifyCadence([])).toBeNull();
  });
});

describe("detectRecurringCandidates", () => {
  const netflix = [
    tx("2026-05-15", "NETFLIX.COM", 1899),
    tx("2026-06-15", "NETFLIX.COM", 1899),
    tx("2026-07-16", "NETFLIX.COM", 1899),
    tx("2026-08-15", "NETFLIX.COM", 1899),
    tx("2026-09-15", "NETFLIX.COM", 1899),
  ];

  it("detects a monthly charge and prefills the next date after the last one", () => {
    const [candidate] = detectRecurringCandidates(netflix, [], NOW);
    expect(candidate).toBeDefined();
    expect(candidate.cadence).toBe("MONTHLY");
    expect(candidate.label).toBe("NETFLIX.COM");
    expect(candidate.prefill).toMatchObject({
      amountCents: 1899,
      cadence: "MONTHLY",
      accountId: "acct-card",
      categoryId: "cat-fun",
      nextExpectedDate: "2026-10-15",
    });
  });

  it("tells pay on the 15th and last day apart from every two weeks", () => {
    const pay = ["2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15"].map(
      (date) => tx(date, "ACME PAYROLL", 250_000, { type: "INCOME" }),
    );
    const [candidate] = detectRecurringCandidates(pay, [], NOW);
    expect(candidate.cadence).toBe("SEMI_MONTHLY");
    // Aug 15 2026 was a Saturday, paid on the Friday before.
    expect(candidate.prefill).toMatchObject({
      cadence: "SEMI_MONTHLY",
      nextExpectedDate: "2026-09-30",
      semiMonthly: { day: 15, secondDay: 31, beforeWeekend: true },
    });

    const biweekly = ["2026-06-05", "2026-06-19", "2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11"];
    expect(semiMonthlyScheduleOf(biweekly.map((d) => new Date(`${d}T00:00:00.000Z`)))!.regularShare).toBeLessThan(0.75);
    const [everyTwoWeeks] = detectRecurringCandidates(
      biweekly.map((date) => tx(date, "OTHER PAYROLL", 180_000, { type: "INCOME" })),
      [],
      NOW,
    );
    expect(everyTwoWeeks.cadence).toBe("BIWEEKLY");
  });

  it("groups a bank description with a hand-typed title for the same merchant", () => {
    const mixed = [
      tx("2026-06-03", "SQ *BLUE BOTTLE #412 TORONTO ON", 2500),
      tx("2026-07-03", "Blue Bottle", 2500),
      tx("2026-08-03", "BLUE BOTTLE", 2500),
      tx("2026-09-03", "blue bottle", 2500),
    ];
    expect(detectRecurringCandidates(mixed, [], NOW)).toHaveLength(1);
  });

  it("tolerates one irregular gap", () => {
    const withLateCharge = [
      tx("2026-04-01", "Gym Co", 4500),
      tx("2026-05-01", "Gym Co", 4500),
      tx("2026-06-12", "Gym Co", 4500),
      tx("2026-07-01", "Gym Co", 4500),
      tx("2026-08-01", "Gym Co", 4500),
      tx("2026-09-01", "Gym Co", 4500),
    ];
    expect(detectRecurringCandidates(withLateCharge, [], NOW)[0]?.cadence).toBe("MONTHLY");
  });

  it("ignores same-store shopping whose amounts vary", () => {
    const groceries = [5210, 8840, 3120, 12050, 6600].map((amount, i) =>
      tx(`2026-08-${String(1 + i * 7).padStart(2, "0")}`, "FreshCo", amount),
    );
    expect(detectRecurringCandidates(groceries, [], NOW)).toEqual([]);
  });

  it("ignores a series that has stopped", () => {
    const lapsed = [tx("2026-03-10", "Old App", 999), tx("2026-04-10", "Old App", 999), tx("2026-05-10", "Old App", 999)];
    expect(detectRecurringCandidates(lapsed, [], NOW)).toEqual([]);
  });

  it("needs enough repetitions for the cadence", () => {
    expect(detectRecurringCandidates(netflix.slice(-2), [], NOW)).toEqual([]);
  });

  it("skips merchants a rule already covers, by name or by linked transactions", () => {
    const rule = { id: "r1", name: "Netflix.com", type: "EXPENSE" as const, amountCents: 1899, cadence: "MONTHLY" as const, enabled: true, categoryId: "c" };
    expect(detectRecurringCandidates(netflix, [rule], NOW)).toEqual([]);
    const linked = [...netflix.slice(0, 4), { ...netflix[4], recurringTransactionId: "r9" }];
    expect(detectRecurringCandidates(linked, [], NOW)).toEqual([]);
    // A disabled rule does not count as tracking it.
    expect(detectRecurringCandidates(netflix, [{ ...rule, enabled: false }], NOW)).toHaveLength(1);
  });

  it("detects biweekly income", () => {
    const pay = ["2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11"].map((d) =>
      tx(d, "ACME PAYROLL", 250000, { type: "INCOME", categoryId: "cat-salary" }),
    );
    const [candidate] = detectRecurringCandidates(pay, [], NOW);
    expect(candidate?.cadence).toBe("BIWEEKLY");
    expect(candidate?.type).toBe("INCOME");
    expect(recurringCandidateInsights([candidate], fmt)[0].key).toBe("recurring:INCOME:acme payroll");
  });
});
