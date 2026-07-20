import { describe, expect, it } from "vitest";

import {
  computeReallocationPlan,
  headroomCents,
  overageCents,
  type ReallocationRow,
} from "./budget-reallocation";

const rows: ReallocationRow[] = [
  { categoryId: "groceries", categoryName: "Groceries", spentCents: 25000, limitCents: 20000 }, // $50 over
  { categoryId: "dining", categoryName: "Dining", spentCents: 10000, limitCents: 40000 }, // $300 headroom
  { categoryId: "gas", categoryName: "Gas", spentCents: 4000, limitCents: 6000 }, // $20 headroom
  { categoryId: "rent", categoryName: "Rent", spentCents: 100000, limitCents: 100000 }, // no headroom
];

describe("overageCents / headroomCents", () => {
  it("computes overage and headroom, flooring at zero", () => {
    expect(overageCents({ spentCents: 25000, limitCents: 20000 })).toBe(5000);
    expect(overageCents({ spentCents: 100, limitCents: 500 })).toBe(0);
    expect(headroomCents({ spentCents: 10000, limitCents: 40000 })).toBe(30000);
    expect(headroomCents({ spentCents: 500, limitCents: 100 })).toBe(0);
  });
});

describe("computeReallocationPlan", () => {
  it("covers an overage from a single source", () => {
    const plan = computeReallocationPlan(rows, "groceries", [
      { categoryId: "dining", amountCents: 5000 },
    ]);
    expect(plan).toEqual([
      { categoryId: "groceries", newLimitCents: 25000 },
      { categoryId: "dining", newLimitCents: 35000 },
    ]);
  });

  it("splits an overage across multiple sources", () => {
    const plan = computeReallocationPlan(rows, "groceries", [
      { categoryId: "dining", amountCents: 3000 },
      { categoryId: "gas", amountCents: 2000 },
    ]);
    expect(plan).toEqual([
      { categoryId: "groceries", newLimitCents: 25000 },
      { categoryId: "dining", newLimitCents: 37000 },
      { categoryId: "gas", newLimitCents: 4000 },
    ]);
  });

  it("allows a partial cover (less than the full overage)", () => {
    const plan = computeReallocationPlan(rows, "groceries", [
      { categoryId: "dining", amountCents: 2000 },
    ]);
    expect(plan).toEqual([
      { categoryId: "groceries", newLimitCents: 22000 },
      { categoryId: "dining", newLimitCents: 38000 },
    ]);
  });

  it("rejects when the destination is not over budget", () => {
    expect(() =>
      computeReallocationPlan(rows, "dining", [{ categoryId: "gas", amountCents: 1000 }]),
    ).toThrow(/no longer over budget/i);
  });

  it("rejects an unknown destination", () => {
    expect(() =>
      computeReallocationPlan(rows, "nope", [{ categoryId: "dining", amountCents: 1000 }]),
    ).toThrow(/no longer has a budget/i);
  });

  it("rejects when a transfer exceeds the source headroom", () => {
    expect(() =>
      computeReallocationPlan(rows, "groceries", [{ categoryId: "gas", amountCents: 3000 }]),
    ).toThrow(/left to give/i);
  });

  it("rejects a source with no headroom", () => {
    expect(() =>
      computeReallocationPlan(rows, "groceries", [{ categoryId: "rent", amountCents: 100 }]),
    ).toThrow(/left to give/i);
  });

  it("rejects transferring more than the overage in total", () => {
    expect(() =>
      computeReallocationPlan(rows, "groceries", [
        { categoryId: "dining", amountCents: 4000 },
        { categoryId: "gas", amountCents: 2000 },
      ]),
    ).toThrow(/more than the overage/i);
  });

  it("rejects using a category as its own source", () => {
    expect(() =>
      computeReallocationPlan(rows, "groceries", [{ categoryId: "groceries", amountCents: 1000 }]),
    ).toThrow(/its own overage/i);
  });

  it("rejects duplicate source categories", () => {
    expect(() =>
      computeReallocationPlan(rows, "groceries", [
        { categoryId: "dining", amountCents: 1000 },
        { categoryId: "dining", amountCents: 1000 },
      ]),
    ).toThrow(/only be used once/i);
  });

  it("rejects an empty transfer list", () => {
    expect(() => computeReallocationPlan(rows, "groceries", [])).toThrow(/at least one budget/i);
  });

  it("rejects non-positive or non-integer amounts", () => {
    expect(() =>
      computeReallocationPlan(rows, "groceries", [{ categoryId: "dining", amountCents: 0 }]),
    ).toThrow(/positive/i);
    expect(() =>
      computeReallocationPlan(rows, "groceries", [{ categoryId: "dining", amountCents: 12.5 }]),
    ).toThrow(/positive/i);
  });

  it("rejects an unknown source category", () => {
    expect(() =>
      computeReallocationPlan(rows, "groceries", [{ categoryId: "ghost", amountCents: 1000 }]),
    ).toThrow(/no longer exists/i);
  });
});
