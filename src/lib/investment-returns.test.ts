import { describe, expect, it } from "vitest";
import { displayRate, returnOver, returnWindows, xirr } from "./investment-returns";

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("xirr", () => {
  it("finds the yearly rate the flows imply", () => {
    expect(xirr([{ date: day("2025-01-01"), cents: -100_000 }, { date: day("2026-01-01"), cents: 110_000 }])).toBeCloseTo(0.1, 4);
    // Money added halfway earns for half the year: 10,000 at the start and 1,000 at mid-year
    // ending at 12,100 is more than 10% a year.
    const rate = xirr([
      { date: day("2025-01-01"), cents: -1_000_000 },
      { date: day("2025-07-02"), cents: -100_000 },
      { date: day("2026-01-01"), cents: 1_210_000 },
    ])!;
    expect(1_000_000 * (1 + rate) + 100_000 * Math.pow(1 + rate, 183 / 365)).toBeCloseTo(1_210_000, -1);
    expect(xirr([{ date: day("2025-01-01"), cents: -5 }])).toBeNull();
    expect(xirr([{ date: day("2025-01-01"), cents: -5 }, { date: day("2025-02-01"), cents: -5 }])).toBeNull();
  });
});

describe("returns over a window", () => {
  const tfsa = {
    values: [
      { date: day("2024-12-31"), cents: 1_000_000 },
      { date: day("2025-06-30"), cents: 1_150_000 },
      { date: day("2025-12-31"), cents: 1_300_000 },
    ],
    flows: [
      { date: day("2024-12-31"), cents: 500_000 }, // already in the first value
      { date: day("2025-03-01"), cents: 200_000 },
      { date: day("2025-09-01"), cents: -50_000 },
      { date: day("2026-01-05"), cents: 100_000 }, // after the latest value: not in it yet
    ],
  };

  it("separates what was put in from growth, counting only flows the readings cover", () => {
    const w = returnOver([tfsa], day("2025-01-01"))!;
    expect(w).toMatchObject({ startCents: 1_000_000, endCents: 1_300_000, netContributedCents: 150_000, growthCents: 150_000 });
    expect(w.startDate).toEqual(day("2024-12-31"));
    expect(w.annualRate!).toBeGreaterThan(0.13);
    expect(w.annualRate!).toBeLessThan(0.17);
    expect(displayRate(w)).toEqual({ rate: w.annualRate, annualized: true });
  });

  it("starts an account first valued inside the window from that value, and adds accounts together", () => {
    const newer = { values: [{ date: day("2025-06-30"), cents: 200_000 }, { date: day("2025-12-31"), cents: 210_000 }], flows: [] };
    const w = returnOver([tfsa, newer], day("2025-01-01"))!;
    expect(w).toMatchObject({ startCents: 1_200_000, endCents: 1_510_000, growthCents: 160_000 });
    // Half a year on its own: shown for the period, not annualized.
    const half = returnOver([newer], null)!;
    expect(half.periodRate!).toBeCloseTo(0.05, 3);
    expect(displayRate(half)).toEqual({ rate: half.periodRate, annualized: false });
  });

  it("has nothing to say with a single reading", () => {
    expect(returnOver([{ values: [{ date: day("2025-06-30"), cents: 5 }], flows: [] }], null)).toBeNull();
    const windows = returnWindows([tfsa], "2026-01-10");
    expect(windows.thisYear).toBeNull(); // nothing read since Jan 1
    expect(windows.sinceStart?.startDate).toEqual(day("2024-12-31"));
  });
});
