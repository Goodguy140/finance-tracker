import { describe, expect, it } from "vitest";
import {
  budgetPeriodMonthInYtd,
  currentPeriodYm,
  describeDashboardPeriod,
  endExclusiveOfMonthYm,
  formatYmLongLabel,
  parseDashboardSearchParams,
  shiftYm,
  startOfCalendarYearForYm,
  startOfMonthYm,
  ytdFirstMonthYm,
} from "./dashboard-period";

const ref = new Date(Date.UTC(2025, 4, 15, 12, 0, 0, 0)); // May 2025

/** Late April 30 local; UTC month is May on negative-offset hosts. */
const localAprilBoundaryRef = new Date(2025, 3, 30, 23, 0, 0);

function withTimezone<T>(tz: string, callback: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return callback();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

function utcPeriodYm(reference: Date): string {
  return `${reference.getUTCFullYear()}-${String(reference.getUTCMonth() + 1).padStart(2, "0")}`;
}

describe("currentPeriodYm", () => {
  it("uses local calendar fields, not UTC, at a month boundary", () => {
    expect(localAprilBoundaryRef.getFullYear()).toBe(2025);
    expect(localAprilBoundaryRef.getMonth()).toBe(3);
    expect(currentPeriodYm(localAprilBoundaryRef)).toBe("2025-04");
  });

  it("stays in the local month when UTC has already moved on", () => {
    // Pinned: on a UTC host (CI) local and UTC agree, and the difference is never tested.
    withTimezone("America/Toronto", () => {
      const lateApril30 = new Date(2025, 3, 30, 23, 0, 0);
      expect(utcPeriodYm(lateApril30)).toBe("2025-05");
      expect(currentPeriodYm(lateApril30)).toBe("2025-04");
    });
  });
});

describe("parseDashboardSearchParams", () => {
  it("defaults ym to currentPeriodYm(reference) when params are empty", () => {
    const p = parseDashboardSearchParams({}, localAprilBoundaryRef);
    expect(p.range).toBe("month");
    expect(p.ym).toBe(currentPeriodYm(localAprilBoundaryRef));
    expect(p.ym).toBe("2025-04");
    expect(p.transactionDateFilter).toEqual({
      date: {
        gte: startOfMonthYm("2025-04"),
        lt: endExclusiveOfMonthYm("2025-04"),
      },
    });
  });

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

  it("falls back to the default month for an impossible month like 2024-13", () => {
    const p = parseDashboardSearchParams({ month: "2024-13", range: "month" }, ref);
    expect(p.ym).toBe(currentPeriodYm(ref));
    expect(parseDashboardSearchParams({ month: "2024-00" }, ref).ym).toBe(currentPeriodYm(ref));
  });

  it("resolves the default month in the user's time zone when one is given", () => {
    // 2025-05-01T03:30Z is still April 30 in Toronto but May 1 in Tokyo.
    const boundary = new Date("2025-05-01T03:30:00.000Z");
    expect(parseDashboardSearchParams({}, boundary, "America/Toronto").ym).toBe("2025-04");
    expect(parseDashboardSearchParams({}, boundary, "Asia/Tokyo").ym).toBe("2025-05");
    expect(parseDashboardSearchParams({ preset: "previous-month" }, boundary, "Asia/Tokyo").ym).toBe("2025-04");
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

describe("formatYmLongLabel", () => {
  it("formats the YM calendar month in UTC (not local TZ shift)", () => {
    const ym = "2026-05";
    const utcExpected = startOfMonthYm(ym).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const localWithoutUtc = startOfMonthYm(ym).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
    expect(formatYmLongLabel(ym)).toBe(utcExpected);
    if (localWithoutUtc !== utcExpected) {
      expect(formatYmLongLabel(ym)).not.toBe(localWithoutUtc);
    }
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

  it("formats month range with UTC calendar month", () => {
    expect(
      describeDashboardPeriod({
        range: "month",
        ym: "2026-05",
        transactionDateFilter: {
          date: { gte: startOfMonthYm("2026-05"), lt: endExclusiveOfMonthYm("2026-05") },
        },
      }),
    ).toBe(formatYmLongLabel("2026-05"));
  });

  it("formats month labels from the UTC month instead of local previous day", () => {
    withTimezone("America/Sao_Paulo", () => {
      const mayStart = startOfMonthYm("2026-05");
      const localLabel = mayStart.toLocaleString(undefined, { month: "long", year: "numeric" });
      const utcLabel = mayStart.toLocaleString(undefined, {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
      });

      expect(localLabel).not.toBe(utcLabel);
      expect(formatYmLongLabel("2026-05")).toBe(utcLabel);
      expect(
        describeDashboardPeriod({
          range: "month",
          ym: "2026-05",
          transactionDateFilter: {},
        }),
      ).toBe(utcLabel);
    });
  });

  it("formats YTD through the UTC anchor month", () => {
    withTimezone("America/Sao_Paulo", () => {
      const from = startOfCalendarYearForYm("2026-05").toLocaleString(undefined, {
        timeZone: "UTC",
        month: "short",
      });
      const to = startOfMonthYm("2026-05").toLocaleString(undefined, {
        timeZone: "UTC",
        month: "short",
        year: "numeric",
      });

      expect(
        describeDashboardPeriod({
          range: "ytd",
          ym: "2026-05",
          transactionDateFilter: {},
        }),
      ).toBe(`Year to date (${from}–${to})`);
    });
  });
});

describe("custom range", () => {
  it("filters to the days picked, both included, and anchors on the last one's month", () => {
    const parsed = parseDashboardSearchParams({ range: "custom", from: "2026-09-28", to: "2026-10-04" });
    expect(parsed.range).toBe("custom");
    expect(parsed.ym).toBe("2026-10");
    expect(parsed.transactionDateFilter).toEqual({
      date: { gte: new Date(Date.UTC(2026, 8, 28)), lt: new Date(Date.UTC(2026, 9, 5)) },
    });
    expect(describeDashboardPeriod(parsed)).toBe("Sep 28 – Oct 4, 2026");
  });

  it("falls back to the month view when the days are missing or backwards", () => {
    const ref = new Date(2026, 9, 15);
    expect(parseDashboardSearchParams({ range: "custom", from: "2026-10-04" }, ref).range).toBe("month");
    expect(parseDashboardSearchParams({ range: "custom", from: "2026-10-04", to: "2026-10-01" }, ref).range).toBe("month");
  });
});
