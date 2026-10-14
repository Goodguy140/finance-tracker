import { describe, expect, it } from "vitest";
import { assignCategoryColors, CATEGORY_PALETTE, categoryColor, NEUTRAL_CATEGORY_COLOR } from "./category-colors";

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `cat-${i}`, createdAt: at(i + 1) }));

describe("assignCategoryColors", () => {
  it("gives every category its own colour while the palette lasts", () => {
    const colors = assignCategoryColors(make(CATEGORY_PALETTE.length));
    expect(new Set(Object.values(colors)).size).toBe(CATEGORY_PALETTE.length);
  });

  it("does not depend on the order the categories arrive in", () => {
    const cats = make(9);
    expect(assignCategoryColors([...cats].reverse())).toEqual(assignCategoryColors(cats));
  });

  it("never recolours an existing category when one is added", () => {
    const cats = make(8);
    const before = assignCategoryColors(cats);
    const after = assignCategoryColors([...cats, { id: "brand-new", createdAt: at(30) }]);
    for (const { id } of cats) expect(after[id]).toBe(before[id]);
  });

  it("reuses the palette past its length rather than failing", () => {
    const colors = assignCategoryColors(make(CATEGORY_PALETTE.length + 3));
    expect(Object.keys(colors)).toHaveLength(CATEGORY_PALETTE.length + 3);
  });

  it("falls back to the neutral colour for an unknown category", () => {
    expect(categoryColor({}, "gone")).toBe(NEUTRAL_CATEGORY_COLOR);
  });
});
