import { describe, expect, it } from "vitest";
import { minimumsTotal, parseAprInput, simulatePayoff, type Debt } from "./debt-payoff";

const card: Debt = { id: "card", name: "Visa", balanceCents: 500_000, aprBps: 1999, minimumCents: 15_000 };
const car: Debt = { id: "car", name: "Car loan", balanceCents: 300_000, aprBps: 600, minimumCents: 20_000 };
const store: Debt = { id: "store", name: "Store card", balanceCents: 50_000, aprBps: 2999, minimumCents: 2_500 };

describe("debt payoff", () => {
  it("pays a single debt off with interest, month by month", () => {
    const result = simulatePayoff([{ id: "a", name: "A", balanceCents: 120_000, aprBps: 1200, minimumCents: 10_000 }], 10_000, "avalanche");
    // 1% a month on $1,200 at $100 a month: 13 months, a little under $90 of interest.
    expect(result.months).toBe(13);
    expect(result.totalInterestCents).toBeGreaterThan(8_000);
    expect(result.totalInterestCents).toBeLessThan(9_000);
    expect(result.totalPaidCents).toBe(120_000 + result.totalInterestCents);
  });

  it("avalanche pays the highest rate first and costs the least interest", () => {
    const budget = 60_000;
    const avalanche = simulatePayoff([card, car, store], budget, "avalanche");
    const snowball = simulatePayoff([card, car, store], budget, "snowball");
    const minimums = simulatePayoff([card, car, store], budget, "minimums");
    expect(avalanche.payoffOrder[0].id).toBe("store"); // 29.99% and also smallest
    expect(avalanche.payoffOrder.map((p) => p.id).indexOf("card")).toBeLessThan(
      avalanche.payoffOrder.map((p) => p.id).indexOf("car"),
    );
    expect(snowball.payoffOrder.map((p) => p.id)).toEqual(["store", "car", "card"]);
    expect(avalanche.totalInterestCents).toBeLessThanOrEqual(snowball.totalInterestCents);
    expect(minimums.totalInterestCents).toBeGreaterThan(avalanche.totalInterestCents);
    expect(avalanche.months!).toBeLessThan(minimums.months ?? Infinity);
  });

  it("never pays less than the minimums", () => {
    const low = simulatePayoff([card, car], 1, "avalanche");
    const atMinimums = simulatePayoff([card, car], minimumsTotal([card, car]), "avalanche");
    expect(low).toEqual(atMinimums);
  });

  it("says it never ends when payments do not beat interest", () => {
    const result = simulatePayoff([{ id: "x", name: "X", balanceCents: 1_000_000, aprBps: 2400, minimumCents: 10_000 }], 0, "avalanche");
    expect(result.months).toBeNull();
  });

  it("reads rates people type", () => {
    expect(parseAprInput("19.99")).toBe(1999);
    expect(parseAprInput("6%")).toBe(600);
    expect(parseAprInput("0")).toBe(0);
    expect(parseAprInput("101")).toBeNull();
    expect(parseAprInput("abc")).toBeNull();
  });
});
