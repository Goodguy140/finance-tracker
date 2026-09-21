import { describe, expect, it } from "vitest";
import { buildCumulativeSpendSeries, resolveMonthlyExpected } from "./cumulative-spend";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("buildCumulativeSpendSeries", () => {
  it("accumulates day by day and keeps empty days on the axis", () => {
    const series = buildCumulativeSpendSeries(
      [
        { date: utc(2026, 3, 1), amountCents: 1_000 },
        { date: utc(2026, 3, 3), amountCents: 500 },
        { date: utc(2026, 3, 3), amountCents: 250 },
      ],
      { range: "month", ym: "2026-03", todayYmd: "2026-03-04" },
    );

    expect(series.map((p) => p.label)).toEqual(["1", "2", "3", "4"]);
    expect(series.map((p) => p.cumulativeCents)).toEqual([1_000, 1_000, 1_750, 1_750]);
    expect(series.map((p) => p.bucketCents)).toEqual([1_000, 0, 750, 0]);
  });

  it("stops at today in the current month instead of flat-lining to month end", () => {
    const series = buildCumulativeSpendSeries([{ date: utc(2026, 3, 2), amountCents: 400 }], {
      range: "month",
      ym: "2026-03",
      todayYmd: "2026-03-05",
    });

    expect(series).toHaveLength(5);
    expect(series[4].cumulativeCents).toBe(400);
  });

  it("runs to month end for a month that is already over", () => {
    const series = buildCumulativeSpendSeries([{ date: utc(2026, 2, 2), amountCents: 400 }], {
      range: "month",
      ym: "2026-02",
      todayYmd: "2026-09-21",
    });

    expect(series).toHaveLength(28);
  });

  it("extends past today to include a future-dated expense so the curve matches the period total", () => {
    const rows = [
      { date: utc(2026, 3, 2), amountCents: 400 },
      { date: utc(2026, 3, 20), amountCents: 600 },
    ];
    const series = buildCumulativeSpendSeries(rows, {
      range: "month",
      ym: "2026-03",
      todayYmd: "2026-03-05",
    });

    expect(series).toHaveLength(20);
    expect(series[series.length - 1].cumulativeCents).toBe(
      rows.reduce((sum, r) => sum + r.amountCents, 0),
    );
  });

  it("buckets YTD by month from January through today", () => {
    const series = buildCumulativeSpendSeries(
      [
        { date: utc(2026, 1, 9), amountCents: 100 },
        { date: utc(2026, 3, 9), amountCents: 300 },
      ],
      { range: "ytd", ym: "2026-12", todayYmd: "2026-04-15" },
    );

    expect(series).toHaveLength(4);
    expect(series.map((p) => p.cumulativeCents)).toEqual([100, 100, 400, 400]);
  });

  it("keeps a YTD anchor month in a past year whole", () => {
    const series = buildCumulativeSpendSeries([{ date: utc(2024, 2, 9), amountCents: 100 }], {
      range: "ytd",
      ym: "2024-06",
      todayYmd: "2026-09-21",
    });

    expect(series).toHaveLength(6);
  });

  it("spans only the months that hold spend for lifetime", () => {
    const series = buildCumulativeSpendSeries(
      [
        { date: utc(2025, 11, 4), amountCents: 100 },
        { date: utc(2026, 2, 4), amountCents: 200 },
      ],
      { range: "lifetime", ym: "2026-09", todayYmd: "2026-09-21" },
    );

    expect(series).toHaveLength(4);
    expect(series[0].fullLabel).toContain("2025");
    expect(series[series.length - 1].cumulativeCents).toBe(300);
  });

  it("returns nothing for a lifetime view with no transactions", () => {
    expect(
      buildCumulativeSpendSeries([], { range: "lifetime", ym: "2026-09", todayYmd: "2026-09-21" }),
    ).toEqual([]);
  });

  it("lets a refund pull the running total back down", () => {
    const series = buildCumulativeSpendSeries(
      [
        { date: utc(2026, 3, 1), amountCents: 5_000 },
        { date: utc(2026, 3, 2), amountCents: -2_000 },
      ],
      { range: "month", ym: "2026-03", todayYmd: "2026-03-02" },
    );

    expect(series.map((p) => p.cumulativeCents)).toEqual([5_000, 3_000]);
  });
});

describe("resolveMonthlyExpected", () => {
  it("prefers budgets over the trailing average", () => {
    expect(resolveMonthlyExpected(30_000, [10_000, 12_000, 11_000])).toEqual({
      cents: 30_000,
      basis: "budgets",
    });
  });

  it("averages the recent months when nothing is budgeted", () => {
    expect(resolveMonthlyExpected(0, [10_000, 12_000, 11_000])).toEqual({
      cents: 11_000,
      basis: "average",
    });
  });

  it("counts a zero-spend month in the average rather than dropping it", () => {
    expect(resolveMonthlyExpected(0, [12_000, 0, 6_000])).toEqual({ cents: 6_000, basis: "average" });
  });

  it("gives no baseline without budgets or history", () => {
    expect(resolveMonthlyExpected(0, [])).toBeNull();
    expect(resolveMonthlyExpected(0, [0, 0, 0])).toBeNull();
  });
});

describe("buildCumulativeSpendSeries expected baseline", () => {
  it("prorates a month's expected spend across that month's days", () => {
    const series = buildCumulativeSpendSeries([], {
      range: "month",
      ym: "2026-04", // 30 days
      todayYmd: "2026-04-30",
      monthlyExpected: { cents: 30_000, basis: "budgets" },
    });

    expect(series[0].expectedCents).toBe(1_000);
    expect(series[14].expectedCents).toBe(15_000);
    // Full month's expectation is reached on the last day, not before or after it.
    expect(series[series.length - 1].expectedCents).toBe(30_000);
  });

  it("keeps prorating against the whole month when the view stops at today", () => {
    const series = buildCumulativeSpendSeries([], {
      range: "month",
      ym: "2026-04",
      todayYmd: "2026-04-10",
      monthlyExpected: { cents: 30_000, basis: "budgets" },
    });

    expect(series).toHaveLength(10);
    expect(series[9].expectedCents).toBe(10_000);
  });

  it("adds a whole month of expected spend per monthly bucket", () => {
    const series = buildCumulativeSpendSeries([{ date: utc(2026, 1, 5), amountCents: 1 }], {
      range: "ytd",
      ym: "2026-03",
      todayYmd: "2026-03-15",
      monthlyExpected: { cents: 20_000, basis: "average" },
    });

    expect(series.map((p) => p.expectedCents)).toEqual([20_000, 40_000, 60_000]);
  });

  it("leaves the baseline null when there is nothing to expect", () => {
    const series = buildCumulativeSpendSeries([{ date: utc(2026, 3, 1), amountCents: 500 }], {
      range: "month",
      ym: "2026-03",
      todayYmd: "2026-03-02",
    });

    expect(series.every((p) => p.expectedCents === null)).toBe(true);
  });
});
