import { describe, expect, it } from "vitest";
import { dateFromYmd, ymdFromDateUtc } from "./date-only";
import {
  advanceRecurringDate,
  advanceRecurringDateOnOrAfter,
  bucketIncomeCentsByYm,
  computeRecurringCashFlowSummary,
  computeThreeMonthAverageIncomeCents,
  getPastMonthYmsBefore,
  getRecurringDateStatus,
  isRecurringOccurrenceOnOrAfterNext,
  recurringOccurrenceInMonth,
} from "./recurring-transactions";

describe("advanceRecurringDate", () => {
  it("advances weekly and biweekly cadences by calendar days", () => {
    const start = dateFromYmd("2026-05-01");

    expect(ymdFromDateUtc(advanceRecurringDate(start, "WEEKLY"))).toBe("2026-05-08");
    expect(ymdFromDateUtc(advanceRecurringDate(start, "BIWEEKLY"))).toBe("2026-05-15");
  });

  it("clamps month-end dates across short months", () => {
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2026-01-31"), "MONTHLY"))).toBe("2026-02-28");
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2026-10-31"), "QUARTERLY"))).toBe("2027-01-31");
  });

  it("handles leap years for yearly and biennial cadences", () => {
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2024-02-29"), "YEARLY"))).toBe("2025-02-28");
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2024-02-29"), "BIENNIAL"))).toBe("2026-02-28");
  });

  it("returns to the anchor day after a month that clamped it", () => {
    const feb = dateFromYmd("2026-02-28");
    expect(ymdFromDateUtc(advanceRecurringDate(feb, "MONTHLY", 31))).toBe("2026-03-31");
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2026-03-31"), "MONTHLY", 31))).toBe("2026-04-30");
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2025-11-30"), "QUARTERLY", 31))).toBe("2026-02-28");
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2025-02-28"), "YEARLY", 29))).toBe("2026-02-28");
    expect(ymdFromDateUtc(advanceRecurringDate(dateFromYmd("2027-02-28"), "YEARLY", 29))).toBe("2028-02-29");
  });

  it("advances overdue occurrences one cadence at a time", () => {
    const overdue = dateFromYmd("2026-01-15");

    expect(ymdFromDateUtc(advanceRecurringDate(overdue, "MONTHLY"))).toBe("2026-02-15");
  });
});

describe("advanceRecurringDateOnOrAfter", () => {
  it("leaves future and current expected dates unchanged", () => {
    const today = dateFromYmd("2026-05-10");
    const current = dateFromYmd("2026-05-10");
    const future = dateFromYmd("2026-05-17");

    expect(advanceRecurringDateOnOrAfter(current, "WEEKLY", today).getTime()).toBe(current.getTime());
    expect(advanceRecurringDateOnOrAfter(future, "WEEKLY", today).getTime()).toBe(future.getTime());
  });

  it("does not drift when rolling a month-end date through February", () => {
    const rolled = advanceRecurringDateOnOrAfter(dateFromYmd("2026-01-31"), "MONTHLY", dateFromYmd("2026-03-01"));
    expect(ymdFromDateUtc(rolled)).toBe("2026-03-31");
    // A rule already waiting on Feb 28 lands back on its anchor.
    const fromClamped = advanceRecurringDateOnOrAfter(dateFromYmd("2026-02-28"), "MONTHLY", dateFromYmd("2026-03-01"), 31);
    expect(ymdFromDateUtc(fromClamped)).toBe("2026-03-31");
  });

  it("rolls dates forward only when a forecast needs the first occurrence in a period", () => {
    const rolled = advanceRecurringDateOnOrAfter(
      dateFromYmd("2026-04-01"),
      "BIWEEKLY",
      dateFromYmd("2026-05-01"),
    );

    expect(ymdFromDateUtc(rolled)).toBe("2026-05-13");
  });
});

describe("getRecurringDateStatus", () => {
  it("classifies overdue, due, and upcoming by UTC calendar day", () => {
    const today = dateFromYmd("2026-05-10");

    expect(getRecurringDateStatus(dateFromYmd("2026-05-09"), today)).toBe("overdue");
    expect(getRecurringDateStatus(dateFromYmd("2026-05-10"), today)).toBe("due");
    expect(getRecurringDateStatus(dateFromYmd("2026-05-11"), today)).toBe("upcoming");
  });
});

describe("getPastMonthYmsBefore", () => {
  it("returns the three calendar months before the anchor month", () => {
    expect(getPastMonthYmsBefore("2026-06", 3)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });
});

describe("computeThreeMonthAverageIncomeCents", () => {
  it("averages monthly income totals across the requested months", () => {
    const incomeByYm = bucketIncomeCentsByYm([
      { amountCents: 100_000, date: dateFromYmd("2026-03-01") },
      { amountCents: 50_000, date: dateFromYmd("2026-03-15") },
      { amountCents: 300_000, date: dateFromYmd("2026-04-10") },
      { amountCents: 0, date: dateFromYmd("2026-06-01") },
    ]);

    expect(
      computeThreeMonthAverageIncomeCents(["2026-03", "2026-04", "2026-05"], incomeByYm),
    ).toBe(150_000);
  });
});

describe("computeRecurringCashFlowSummary", () => {
  it("uses expected income override when provided", () => {
    const summary = computeRecurringCashFlowSummary(
      [
        {
          type: "INCOME",
          amountCents: 999_999,
          cadence: "MONTHLY",
          nextExpectedDate: dateFromYmd("2026-05-01"),
          endDate: null,
          enabled: true,
        },
        {
          type: "EXPENSE",
          amountCents: 2_000,
          cadence: "MONTHLY",
          nextExpectedDate: dateFromYmd("2026-05-01"),
          endDate: null,
          enabled: true,
        },
      ],
      {
        start: dateFromYmd("2026-05-01"),
        endExclusive: dateFromYmd("2026-06-01"),
      },
      { expectedIncomeCents: 120_000 },
    );

    expect(summary).toEqual({
      incomeCents: 120_000,
      expenseCents: 2_000,
      netCents: 118_000,
    });
  });

  it("sums enabled recurring income and expenses inside the dashboard period", () => {
    const summary = computeRecurringCashFlowSummary(
      [
        {
          type: "INCOME",
          amountCents: 250_000,
          cadence: "BIWEEKLY",
          nextExpectedDate: dateFromYmd("2026-05-01"),
          endDate: null,
          enabled: true,
        },
        {
          type: "EXPENSE",
          amountCents: 1_500,
          cadence: "WEEKLY",
          nextExpectedDate: dateFromYmd("2026-05-06"),
          endDate: null,
          enabled: true,
        },
        {
          type: "EXPENSE",
          amountCents: 9_999,
          cadence: "MONTHLY",
          nextExpectedDate: dateFromYmd("2026-05-10"),
          endDate: null,
          enabled: false,
        },
      ],
      {
        start: dateFromYmd("2026-05-01"),
        endExclusive: dateFromYmd("2026-06-01"),
      },
    );

    expect(summary).toEqual({
      incomeCents: 750_000,
      expenseCents: 6_000,
      netCents: 744_000,
    });
  });

  it("honors rule end dates", () => {
    const summary = computeRecurringCashFlowSummary(
      [
        {
          type: "EXPENSE",
          amountCents: 1_000,
          cadence: "WEEKLY",
          nextExpectedDate: dateFromYmd("2026-05-01"),
          endDate: dateFromYmd("2026-05-08"),
          enabled: true,
        },
      ],
      {
        start: dateFromYmd("2026-05-01"),
        endExclusive: dateFromYmd("2026-06-01"),
      },
    );

    expect(summary.expenseCents).toBe(2_000);
  });
});

describe("recurringOccurrenceInMonth", () => {
  const rule = (nextYmd: string, cadence: "WEEKLY" | "MONTHLY" | "YEARLY" = "MONTHLY", endYmd?: string) => ({
    cadence,
    nextExpectedDate: dateFromYmd(nextYmd),
    endDate: endYmd ? dateFromYmd(endYmd) : null,
  });
  const occurrence = (r: ReturnType<typeof rule>, ym: string, currentYm = "2026-10") => {
    const date = recurringOccurrenceInMonth(r, ym, currentYm);
    return date ? ymdFromDateUtc(date) : null;
  };

  it("shows a rule in the month of its next expected date", () => {
    expect(occurrence(rule("2026-10-15"), "2026-10")).toBe("2026-10-15");
    expect(occurrence(rule("2026-10-15"), "2026-09")).toBeNull();
  });

  it("carries a rule overdue from an earlier month into the current month at this month's date", () => {
    expect(occurrence(rule("2026-08-20"), "2026-10")).toBe("2026-10-20");
    expect(occurrence(rule("2026-08-20", "WEEKLY"), "2026-10")).toBe("2026-10-01");
    expect(occurrence(rule("2026-08-20"), "2026-11")).toBe("2026-11-20");
  });

  it("keeps the overdue occurrence in its own month and out of the months in between", () => {
    expect(occurrence(rule("2026-08-20"), "2026-08")).toBe("2026-08-20");
    expect(occurrence(rule("2026-08-20"), "2026-09")).toBeNull();
  });

  it("projects a month-end rule waiting on Feb 28 back to the 31st", () => {
    const waiting = { cadence: "MONTHLY" as const, nextExpectedDate: dateFromYmd("2027-02-28"), anchorDay: 31, endDate: null };
    expect(ymdFromDateUtc(recurringOccurrenceInMonth(waiting, "2027-03", "2026-10")!)).toBe("2027-03-31");
  });

  it("projects occurrences into future months", () => {
    expect(occurrence(rule("2026-10-15"), "2026-12")).toBe("2026-12-15");
    expect(occurrence(rule("2026-10-15", "YEARLY"), "2026-12")).toBeNull();
    expect(occurrence(rule("2026-10-15", "YEARLY"), "2027-10")).toBe("2027-10-15");
  });

  it("stops projecting after the rule's end date", () => {
    expect(occurrence(rule("2026-10-15", "MONTHLY", "2026-11-30"), "2026-11")).toBe("2026-11-15");
    expect(occurrence(rule("2026-10-15", "MONTHLY", "2026-11-30"), "2026-12")).toBeNull();
  });
});

describe("isRecurringOccurrenceOnOrAfterNext", () => {
  it("accepts the outstanding date and later dates on the cadence, nothing else", () => {
    const next = dateFromYmd("2026-08-20");
    expect(isRecurringOccurrenceOnOrAfterNext(next, "MONTHLY", dateFromYmd("2026-08-20"))).toBe(true);
    expect(isRecurringOccurrenceOnOrAfterNext(next, "MONTHLY", dateFromYmd("2026-10-20"))).toBe(true);
    expect(isRecurringOccurrenceOnOrAfterNext(next, "MONTHLY", dateFromYmd("2026-10-21"))).toBe(false);
    expect(isRecurringOccurrenceOnOrAfterNext(next, "MONTHLY", dateFromYmd("2026-07-20"))).toBe(false);
  });
});
