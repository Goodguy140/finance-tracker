import { describe, expect, it } from "vitest";
import {
  collapseColumns,
  enforceMinimums,
  largestRemainder,
  minUnitsForWidth,
  redistributeOnAdd,
  redistributeOnRemove,
  resizeAdjacent,
} from "./columns";
import { type DashboardColumn, MIN_COLUMN_UNITS, TOTAL_COLUMN_UNITS } from "./schema";

function column(id: string, weight: number, slotIds: string[]): DashboardColumn {
  return {
    id,
    weight,
    slots: slotIds.map((slotId) => ({ id: slotId, cards: ["budgets" as const], activeIndex: 0 })),
  };
}

const slotIds = (columns: DashboardColumn[]) => columns.map((c) => c.slots.map((s) => s.id));
const weights = (columns: DashboardColumn[]) => columns.map((c) => c.weight);
const total = (columns: DashboardColumn[]) => columns.reduce((sum, c) => sum + c.weight, 0);

describe("largestRemainder", () => {
  it("sums to exactly the total even when the shares do not divide evenly", () => {
    expect(largestRemainder([1, 1, 1], 24)).toEqual([8, 8, 8]);
    expect(largestRemainder([1, 1, 1, 1, 1, 1, 1], 24)).toEqual([4, 4, 4, 3, 3, 3, 3]);
    expect(largestRemainder([14, 10], 24)).toEqual([14, 10]);
  });

  it("distributes evenly when there is no weight to go on", () => {
    expect(largestRemainder([0, 0], 24)).toEqual([12, 12]);
    expect(largestRemainder([0, 0, 0], 25)).toEqual([9, 8, 8]);
  });
});

describe("resizeAdjacent", () => {
  it("moves width between the two neighbours and leaves the total untouched", () => {
    const cols = [column("a", 14, []), column("b", 10, [])];
    expect(weights(resizeAdjacent(cols, 0, 3))).toEqual([17, 7]);
    expect(weights(resizeAdjacent(cols, 0, -4))).toEqual([10, 14]);
  });

  it("never lets either neighbour fall below the minimum", () => {
    const cols = [column("a", 14, []), column("b", 10, [])];
    expect(weights(resizeAdjacent(cols, 0, 999))).toEqual([TOTAL_COLUMN_UNITS - MIN_COLUMN_UNITS, MIN_COLUMN_UNITS]);
    expect(weights(resizeAdjacent(cols, 0, -999))).toEqual([MIN_COLUMN_UNITS, TOTAL_COLUMN_UNITS - MIN_COLUMN_UNITS]);
  });

  it("conserves the total across a long run of random deltas", () => {
    let cols = [column("a", 8, []), column("b", 8, []), column("c", 8, [])];
    for (let i = 0; i < 100; i++) {
      const index = Math.floor(Math.random() * 2);
      cols = resizeAdjacent(cols, index, Math.round((Math.random() - 0.5) * 40));
      expect(total(cols)).toBe(TOTAL_COLUMN_UNITS);
      expect(Math.min(...weights(cols))).toBeGreaterThanOrEqual(MIN_COLUMN_UNITS);
    }
  });

  it("leaves the layout alone when there is no column to the right", () => {
    const cols = [column("a", 24, [])];
    expect(weights(resizeAdjacent(cols, 0, 5))).toEqual([24]);
  });
});

describe("minUnitsForWidth", () => {
  it("demands more units on a narrow container than on a wide one", () => {
    // 320px of a 640px container is half the grid; of a 1920px container it is a tenth.
    expect(minUnitsForWidth(640, 2)).toBe(12);
    expect(minUnitsForWidth(1920, 2)).toBe(4);
  });

  it("never exceeds a fair share, so a cramped container stays resizable", () => {
    expect(minUnitsForWidth(400, 3)).toBeLessThanOrEqual(Math.floor(TOTAL_COLUMN_UNITS / 3));
  });
});

describe("redistributeOnAdd / redistributeOnRemove", () => {
  it("adds a column that takes its width from the others", () => {
    const next = redistributeOnAdd([column("a", 14, []), column("b", 10, [])], "c");
    expect(next).toHaveLength(3);
    expect(total(next)).toBe(TOTAL_COLUMN_UNITS);
    expect(next[2].id).toBe("c");
    expect(next[2].slots).toEqual([]);
  });

  it("refuses to add past the maximum", () => {
    const four = [column("a", 6, []), column("b", 6, []), column("c", 6, []), column("d", 6, [])];
    expect(redistributeOnAdd(four, "e")).toHaveLength(4);
  });

  it("moves a removed column's cards to its left neighbour", () => {
    const cols = [column("a", 8, ["s1"]), column("b", 8, ["s2"]), column("c", 8, ["s3", "s4"])];
    expect(slotIds(redistributeOnRemove(cols, 2))).toEqual([["s1"], ["s2", "s3", "s4"]]);
  });

  it("moves the leftmost column's cards right rather than dropping them", () => {
    const cols = [column("a", 8, ["s1", "s2"]), column("b", 8, ["s3"]), column("c", 8, ["s4"])];
    expect(slotIds(redistributeOnRemove(cols, 0))).toEqual([["s1", "s2", "s3"], ["s4"]]);
  });

  it("refuses to remove the last column", () => {
    const cols = [column("a", 24, ["s1"])];
    expect(slotIds(redistributeOnRemove(cols, 0))).toEqual([["s1"]]);
  });

  it("does not drift off the total across 20 alternating add/remove cycles", () => {
    let cols = [column("a", 14, ["s1"]), column("b", 10, ["s2"])];
    for (let i = 0; i < 20; i++) {
      cols = redistributeOnAdd(cols, `added-${i}`);
      expect(total(cols)).toBe(TOTAL_COLUMN_UNITS);
      cols = redistributeOnRemove(cols, cols.length - 1);
      expect(total(cols)).toBe(TOTAL_COLUMN_UNITS);
      expect(Math.min(...weights(cols))).toBeGreaterThanOrEqual(MIN_COLUMN_UNITS);
    }
    // Nothing was lost along the way.
    expect(slotIds(cols)).toEqual([["s1"], ["s2"]]);
  });
});

describe("enforceMinimums", () => {
  it("re-sums weights that do not add up", () => {
    expect(weights(enforceMinimums([column("a", 0, []), column("b", 0, [])]))).toEqual([12, 12]);
    expect(total(enforceMinimums([column("a", 30, []), column("b", 1, [])]))).toBe(TOTAL_COLUMN_UNITS);
  });

  it("lifts a starved column up to the minimum at the widest column's expense", () => {
    const next = enforceMinimums([column("a", 23, []), column("b", 1, [])]);
    expect(Math.min(...weights(next))).toBeGreaterThanOrEqual(MIN_COLUMN_UNITS);
    expect(total(next)).toBe(TOTAL_COLUMN_UNITS);
  });
});

describe("collapseColumns", () => {
  const four = [
    column("a", 6, ["s1", "s2"]),
    column("b", 6, ["s3"]),
    column("c", 6, ["s4"]),
    column("d", 6, ["s5"]),
  ];

  it("is the identity when nothing needs collapsing", () => {
    expect(slotIds(collapseColumns(four, 4))).toEqual([["s1", "s2"], ["s3"], ["s4"], ["s5"]]);
    expect(weights(collapseColumns(four, 4))).toEqual([6, 6, 6, 6]);
  });

  it("folds four columns into two, pairing neighbours and summing their widths", () => {
    const next = collapseColumns(four, 2);
    expect(slotIds(next)).toEqual([["s1", "s2", "s3"], ["s4", "s5"]]);
    expect(weights(next)).toEqual([12, 12]);
  });

  it("puts every slot in one column in column-major order", () => {
    const next = collapseColumns(four, 1);
    expect(slotIds(next)).toEqual([["s1", "s2", "s3", "s4", "s5"]]);
    expect(total(next)).toBe(TOTAL_COLUMN_UNITS);
  });

  it("never returns more columns than it was given", () => {
    expect(collapseColumns(four, 99)).toHaveLength(4);
    expect(collapseColumns(four, 0)).toHaveLength(1);
  });
});
