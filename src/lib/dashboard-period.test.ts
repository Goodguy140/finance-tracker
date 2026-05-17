import { describe, expect, it } from "vitest";
import {
  budgetPeriodMonthInYtd,
  describeDashboardPeriod,
  endExclusiveOfMonthYm,
  parseDashboardSearchParams,
  shiftYm,
  startOfCalendarYearForYm,
  startOfMonthYm,
  ytdFirstMonthYm,
} from "./dashboard-period";

const ref = new Date(Date.UTC(2025, 4, 15, 12, 0, 0, 0)); // May 2025

describe("parseDashboardSearchParams", () => {
  it("defaults to current month when params missing", () => {
    const p = parseDashboardSearchParams({}, ref);
    expect(p.range).toBe("month");
    expect(p.ym).toBe("2025-05");
    expect(p.transactionDateFilter).toEqual({
      date: {
        gte: startOfMonthYm("2025-05"),
        lt: endExclusiveOfMonthYm("2025-05"),
      },
    });
  });

  it("parses explicit month range", () => {
    const p = parseDashboardSearchParams({ month: "2024-03", range: "month" }, ref);
    expect(p.range).toBe("month");
    expect(p.ym).toBe("2024-03");
    expect(p.transactionDateFilter).toEqual({
      date: {
        gte: startOfMonthYm("2024-03"),
        lt: endExclusiveOfMonthYm("2024-03"),
      },
    });
  });

  it("resolves the previous month preset relative to the reference month", () => {
    const may = parseDashboardSearchParams({ preset: "previous-month" }, ref);
    const june = parseDashboardSearchParams({ preset: "previous-month" }, new Date(Date.UTC(2025, 5, 1, 12)));

    expect(may.range).toBe("month");
    expect(may.ym).toBe("2025-04");
    expect(may.transactionDateFilter).toEqual({
      date: {
        gte: startOfMonthYm("2025-04"),
        lt: endExclusiveOfMonthYm("2025-04"),
      },
    });
    expect(june.ym).toBe("2025-05");
  });

  it("keeps YTD without an explicit month tied to the current reference month", () => {
    const may = parseDashboardSearchParams({ range: "ytd" }, ref);
    const june = parseDashboardSearchParams({ range: "ytd" }, new Date(Date.UTC(2025, 5, 1, 12)));

    expect(may.range).toBe("ytd");
    expect(may.ym).toBe("2025-05");
    expect(june.ym).toBe("2025-06");
    expect(june.transactionDateFilter).toEqual({
      date: {
        gte: startOfCalendarYearForYm("2025-06"),
        lt: endExclusiveOfMonthYm("2025-06"),
      },
    });
  });

  it("ytd uses Jan 1 through end of anchor month", () => {
    const p = parseDashboardSearchParams({ month: "2024-08", range: "ytd" }, ref);
    expect(p.range).toBe("ytd");
    expect(p.ym).toBe("2024-08");
    expect(p.transactionDateFilter).toEqual({
      date: {
        gte: startOfCalendarYearForYm("2024-08"),
        lt: endExclusiveOfMonthYm("2024-08"),
      },
    });
    expect(startOfCalendarYearForYm("2024-08")).toEqual(new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 0)));
    expect(endExclusiveOfMonthYm("2024-08")).toEqual(new Date(Date.UTC(2024, 8, 1, 0, 0, 0, 0)));
  });

  it("lifetime has empty date filter", () => {
    const p = parseDashboardSearchParams({ month: "2023-01", range: "lifetime" }, ref);
    expect(p.range).toBe("lifetime");
    expect(p.transactionDateFilter).toEqual({});
  });

  it("month=all forces lifetime", () => {
    const p = parseDashboardSearchParams({ month: "all", range: "month" }, ref);
    expect(p.range).toBe("lifetime");
    expect(p.ym).toBe("2025-05");
    expect(p.transactionDateFilter).toEqual({});
  });

  it("invalid range defaults to month", () => {
    const p = parseDashboardSearchParams({ range: "bogus" as unknown as string }, ref);
    expect(p.range).toBe("month");
  });
});

describe("budgetPeriodMonthInYtd", () => {
  it("includes months in same year from Jan through anchor", () => {
    expect(budgetPeriodMonthInYtd("2025-01", "2025-05")).toBe(true);
    expect(budgetPeriodMonthInYtd("2025-05", "2025-05")).toBe(true);
    expect(budgetPeriodMonthInYtd("2024-12", "2025-05")).toBe(false);
    expect(budgetPeriodMonthInYtd("2025-06", "2025-05")).toBe(false);
  });
});

describe("ytdFirstMonthYm", () => {
  it("returns January of anchor year", () => {
    expect(ytdFirstMonthYm("2024-08")).toBe("2024-01");
  });
});

describe("shiftYm", () => {
  it("shifts across year boundaries", () => {
    expect(shiftYm("2025-01", -1)).toBe("2024-12");
    expect(shiftYm("2024-12", 1)).toBe("2025-01");
  });
});

describe("describeDashboardPeriod", () => {
  it("returns Lifetime for lifetime range", () => {
    expect(
      describeDashboardPeriod({
        range: "lifetime",
        ym: "2025-01",
        transactionDateFilter: {},
      }),
    ).toBe("Lifetime");
  });
});
