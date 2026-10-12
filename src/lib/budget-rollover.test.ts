import { describe, expect, it } from "vitest";
import { rolloverCarryByMonth, spendByMonthAndCategory } from "./budget-rollover";

const budget = (periodMonth: string, limitCents: number) => ({ categoryId: "food", periodMonth, limitCents });

describe("rolloverCarryByMonth", () => {
  it("adds up what each month left over or went over, from the month rollover started", () => {
    const spend = new Map([
      ["2025-12", 99_999], // before rollover: ignored
      ["2026-01", 6_000],
      ["2026-02", 15_000],
    ]);
    const carries = rolloverCarryByMonth([budget("2025-06", 10_000)], "2026-01", "2026-04", spend);
    expect(Object.fromEntries(carries)).toEqual({
      "2026-02": 4_000, // 100 − 60
      "2026-03": -1_000, // 40, then 100 − 150: the surplus is spent and then some
      "2026-04": 9_000, // −10, then March spent nothing
    });
  });

  it("uses the budget in force each month and skips months without one", () => {
    const carries = rolloverCarryByMonth(
      [budget("2026-03", 5_000), budget("2026-05", 20_000)],
      "2026-01",
      "2026-06",
      new Map([["2026-05", 15_000]]),
    );
    expect(carries.get("2026-03")).toBe(0); // no budget in January or February
    expect(carries.get("2026-05")).toBe(10_000); // March and April at 50 each
    expect(carries.get("2026-06")).toBe(15_000); // May: 200 − 150
  });

  it("carries nothing into the month rollover starts", () => {
    expect(rolloverCarryByMonth([budget("2026-01", 10_000)], "2026-03", "2026-03", new Map()).size).toBe(0);
  });
});

describe("spendByMonthAndCategory", () => {
  it("attributes split expenses to their parts, by month", () => {
    const spend = spendByMonthAndCategory([
      { date: new Date("2026-01-31T00:00:00Z"), categoryId: "food", amountCents: 1_000, splitParts: [] },
      {
        date: new Date("2026-02-01T00:00:00Z"),
        categoryId: "food",
        amountCents: 3_000,
        splitParts: [
          { categoryId: "food", amountCents: 1_000 },
          { categoryId: "fun", amountCents: 2_000 },
        ],
      },
    ]);
    expect(Object.fromEntries(spend)).toEqual({ "2026-01|food": 1_000, "2026-02|food": 1_000, "2026-02|fun": 2_000 });
  });
});
