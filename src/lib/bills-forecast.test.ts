import { describe, expect, it } from "vitest";
import type { RecurringCadence, TransactionType } from "@prisma/client";
import { forecastRecurringOccurrences, groupForecastByDay } from "./bills-forecast";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";

function rule(
  name: string,
  overrides: Partial<{
    type: TransactionType;
    amountCents: number;
    cadence: RecurringCadence;
    next: string;
    end: string | null;
    enabled: boolean;
  }> = {},
) {
  return {
    name,
    type: overrides.type ?? ("EXPENSE" as TransactionType),
    amountCents: overrides.amountCents ?? 10_000,
    cadence: overrides.cadence ?? ("MONTHLY" as RecurringCadence),
    nextExpectedDate: dateFromYmd(overrides.next ?? "2026-10-15"),
    endDate: overrides.end ? dateFromYmd(overrides.end) : null,
    enabled: overrides.enabled ?? true,
  };
}

const TODAY = { todayYmd: "2026-10-10", currentYm: "2026-10" };

function rows(result: ReturnType<typeof forecastRecurringOccurrences<ReturnType<typeof rule>>>) {
  return result.occurrences.map((o) => ({
    name: o.rule.name,
    date: ymdFromDateUtc(o.date),
    overdue: o.overdue,
    missedSince: o.missedSince ? ymdFromDateUtc(o.missedSince) : null,
  }));
}

describe("forecastRecurringOccurrences", () => {
  it("lists every occurrence in the window, earliest first, and totals them by type", () => {
    const result = forecastRecurringOccurrences(
      [
        rule("Rent", { next: "2026-11-01", amountCents: 150_000 }),
        rule("Pay", { type: "INCOME", cadence: "BIWEEKLY", next: "2026-10-16", amountCents: 200_000 }),
        rule("Phone", { next: "2026-10-12", amountCents: 5_000 }),
      ],
      { ...TODAY, days: 30 },
    );

    expect(rows(result).map((r) => `${r.date} ${r.name}`)).toEqual([
      "2026-10-12 Phone",
      "2026-10-16 Pay",
      "2026-10-30 Pay",
      "2026-11-01 Rent",
    ]);
    expect(result.incomeCents).toBe(400_000);
    expect(result.expenseCents).toBe(155_000);
    expect(result.netCents).toBe(245_000);
  });

  it("includes the last day of the window and stops after it", () => {
    const result = forecastRecurringOccurrences([rule("Gym", { cadence: "WEEKLY", next: "2026-10-13" })], {
      ...TODAY,
      days: 14,
    });

    expect(rows(result).map((r) => r.date)).toEqual(["2026-10-13", "2026-10-20"]);
    // 2026-10-24 is the last day of a 14-day window from the 10th.
    const longer = forecastRecurringOccurrences([rule("Gym", { cadence: "WEEKLY", next: "2026-10-17" })], {
      ...TODAY,
      days: 14,
    });
    expect(rows(longer).map((r) => r.date)).toEqual(["2026-10-17", "2026-10-24"]);
  });

  it("skips disabled rules and stops at a rule's end date", () => {
    const result = forecastRecurringOccurrences(
      [
        rule("Old", { enabled: false }),
        rule("Loan", { cadence: "WEEKLY", next: "2026-10-12", end: "2026-10-26" }),
      ],
      { ...TODAY, days: 60 },
    );

    expect(rows(result).map((r) => `${r.date} ${r.name}`)).toEqual([
      "2026-10-12 Loan",
      "2026-10-19 Loan",
      "2026-10-26 Loan",
    ]);
  });

  it("lists an unposted occurrence from earlier this month as overdue and counts it", () => {
    const result = forecastRecurringOccurrences([rule("Hydro", { next: "2026-10-03" })], { ...TODAY, days: 30 });

    expect(rows(result)).toEqual([
      { name: "Hydro", date: "2026-10-03", overdue: true, missedSince: null },
      { name: "Hydro", date: "2026-11-03", overdue: false, missedSince: null },
    ]);
    expect(result.expenseCents).toBe(20_000);
  });

  it("carries a rule overdue from an earlier month into this month without counting the missed one", () => {
    const result = forecastRecurringOccurrences([rule("Internet", { next: "2026-08-20" })], {
      ...TODAY,
      days: 30,
    });

    expect(rows(result)).toEqual([{ name: "Internet", date: "2026-10-20", overdue: false, missedSince: "2026-08-20" }]);
    expect(result.expenseCents).toBe(10_000);
  });

  it("collapses several missed occurrences this month into the latest one", () => {
    const result = forecastRecurringOccurrences([rule("Lunch", { cadence: "WEEKLY", next: "2026-09-29" })], {
      ...TODAY,
      days: 7,
    });

    expect(rows(result)).toEqual([
      { name: "Lunch", date: "2026-10-06", overdue: true, missedSince: "2026-09-29" },
      { name: "Lunch", date: "2026-10-13", overdue: false, missedSince: null },
    ]);
  });

  it("does not collapse past a rule's end date", () => {
    const result = forecastRecurringOccurrences(
      [rule("Course", { cadence: "WEEKLY", next: "2026-10-01", end: "2026-10-05" })],
      { ...TODAY, days: 30 },
    );

    expect(rows(result)).toEqual([{ name: "Course", date: "2026-10-01", overdue: true, missedSince: null }]);
  });
});

describe("groupForecastByDay", () => {
  it("groups same-day occurrences and carries the running net through each day", () => {
    const { occurrences } = forecastRecurringOccurrences(
      [
        rule("Rent", { next: "2026-10-15", amountCents: 150_000 }),
        rule("Pay", { type: "INCOME", next: "2026-10-15", amountCents: 200_000 }),
        rule("Phone", { next: "2026-10-20", amountCents: 5_000 }),
      ],
      { ...TODAY, days: 15 },
    );

    expect(
      groupForecastByDay(occurrences).map((day) => ({
        dateYmd: day.dateYmd,
        names: day.occurrences.map((o) => o.rule.name).sort(),
        runningNetCents: day.runningNetCents,
      })),
    ).toEqual([
      { dateYmd: "2026-10-15", names: ["Pay", "Rent"], runningNetCents: 50_000 },
      { dateYmd: "2026-10-20", names: ["Phone"], runningNetCents: 45_000 },
    ]);
  });
});
