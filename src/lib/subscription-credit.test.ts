import { describe, expect, it } from "vitest";
import { computeSubscriptionCredit, grossCentsForTransaction } from "./subscription-credit";

describe("computeSubscriptionCredit", () => {
  it("returns a plain expense when no one has paid", () => {
    expect(computeSubscriptionCredit({ grossCents: 2000, paidShareCents: [] })).toEqual({
      amountCents: 2000,
      preCreditCents: null,
      creditCents: null,
      creditBreakdownJson: null,
    });
  });

  it("ignores zero/negative shares so they do not create empty credits", () => {
    expect(computeSubscriptionCredit({ grossCents: 2000, paidShareCents: [0, -5] })).toEqual({
      amountCents: 2000,
      preCreditCents: null,
      creditCents: null,
      creditBreakdownJson: null,
    });
  });

  it("credits a single paid share and records the breakdown", () => {
    expect(computeSubscriptionCredit({ grossCents: 2000, paidShareCents: [500] })).toEqual({
      amountCents: 1500,
      preCreditCents: 2000,
      creditCents: 500,
      creditBreakdownJson: "[500]",
    });
  });

  it("sums multiple paid shares", () => {
    const result = computeSubscriptionCredit({ grossCents: 3000, paidShareCents: [500, 1000] });
    expect(result.amountCents).toBe(1500);
    expect(result.creditCents).toBe(1500);
    expect(result.preCreditCents).toBe(3000);
    expect(JSON.parse(result.creditBreakdownJson!)).toEqual([500, 1000]);
  });

  it("allows a fully reimbursed bill (net zero)", () => {
    const result = computeSubscriptionCredit({ grossCents: 1000, paidShareCents: [600, 400] });
    expect(result.amountCents).toBe(0);
    expect(result.creditCents).toBe(1000);
  });

  it("rejects shares that exceed the billed amount", () => {
    expect(() => computeSubscriptionCredit({ grossCents: 1000, paidShareCents: [600, 600] })).toThrow(
      /exceed the subscription's billed amount/,
    );
  });
});

describe("grossCentsForTransaction", () => {
  it("uses preCreditCents when credits are present", () => {
    expect(grossCentsForTransaction({ amountCents: 1500, preCreditCents: 2000 })).toBe(2000);
  });

  it("falls back to amountCents when there are no credits", () => {
    expect(grossCentsForTransaction({ amountCents: 2000, preCreditCents: null })).toBe(2000);
  });
});
