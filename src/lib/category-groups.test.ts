import { describe, expect, it } from "vitest";
import { groupYearRows, hasGroups, mergeSlicesByGroup, normalizeGroupName, sectionByGroup } from "./category-groups";

describe("category groups", () => {
  it("normalises names and treats blank as no group", () => {
    expect(normalizeGroupName("  Eating   out ")).toBe("Eating out");
    expect(normalizeGroupName("   ")).toBeNull();
    expect(() => normalizeGroupName("x".repeat(41))).toThrow("at most 40");
  });

  it("sections items by group, alphabetically, case-insensitively, ungrouped last", () => {
    const items = [
      { name: "Rent", group: null },
      { name: "Groceries", group: "Food" },
      { name: "Gas", group: "Car" },
      { name: "Restaurants", group: "food" },
    ];
    const sections = sectionByGroup(items, (i) => i.group);
    expect(sections.map((s) => [s.groupName, s.items.map((i) => i.name)])).toEqual([
      ["Car", ["Gas"]],
      ["Food", ["Groceries", "Restaurants"]],
      [null, ["Rent"]],
    ]);
    expect(hasGroups(items, (i) => i.group)).toBe(true);
    expect(hasGroups([{ group: null }], (i) => i.group)).toBe(false);
  });

  it("adds pie slices up per group, keeping the biggest member's colour and re-sorting", () => {
    const merged = mergeSlicesByGroup([
      { name: "Rent", cents: 150_000, color: "red", groupName: null },
      { name: "Groceries", cents: 90_000, color: "green", groupName: "Food" },
      { name: "Restaurants", cents: 70_000, color: "blue", groupName: "Food" },
      { name: "Refunds", cents: 0, color: "grey", groupName: null },
    ]);
    expect(merged).toEqual([
      { name: "Food", cents: 160_000, color: "green", categoryCount: 2 },
      { name: "Rent", cents: 150_000, color: "red", categoryCount: 1 },
    ]);
  });

  it("totals year-over-year rows per group and leaves ungrouped categories out", () => {
    const rows = [
      { categoryId: "g", categoryName: "Groceries", currentCents: 900, previousCents: 800 },
      { categoryId: "r", categoryName: "Restaurants", currentCents: 300, previousCents: 200 },
      { categoryId: "x", categoryName: "Rent", currentCents: 5000, previousCents: 5000 },
    ];
    const groups = groupYearRows(rows, new Map([["g", "Food"], ["r", "Food"], ["x", null]]));
    expect(groups).toEqual([
      { groupName: "Food", categoryNames: ["Groceries", "Restaurants"], currentCents: 1200, previousCents: 1000, changeRatio: 0.2 },
    ]);
  });
});
