import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add";

// A Wednesday.
const TODAY = "2026-10-28";

describe("parseQuickAdd", () => {
  it("reads an amount, a title and a date in any order", () => {
    expect(parseQuickAdd("12.50 tim hortons yesterday", TODAY)).toEqual({
      amountCents: 1250,
      title: "Tim Hortons",
      dateYmd: "2026-10-27",
    });
    expect(parseQuickAdd("Oct 3 $40 IKEA", TODAY)).toEqual({ amountCents: 4000, title: "IKEA", dateYmd: "2026-10-03" });
    expect(parseQuickAdd("gas 55", TODAY)).toEqual({ amountCents: 5500, title: "Gas", dateYmd: TODAY });
  });

  it("takes the most recent weekday and a month-day that is not ahead", () => {
    expect(parseQuickAdd("lunch 14 monday", TODAY)?.dateYmd).toBe("2026-10-26");
    expect(parseQuickAdd("coffee 4 wednesday", TODAY)?.dateYmd).toBe(TODAY);
    // Late December, typed in October, is last year's.
    expect(parseQuickAdd("gift 30.00 dec 24", TODAY)?.dateYmd).toBe("2025-12-24");
  });

  it("prefers a number written as money over a count in the title", () => {
    expect(parseQuickAdd("2 coffees 9.50", TODAY)).toMatchObject({ amountCents: 950, title: "2 Coffees" });
  });

  it("offers nothing for an ordinary search", () => {
    for (const text of ["tim hortons", "12.50", "oct 27", "2 coffees 9 muffins", "Sun Life", "12.50 tim oct 27 yesterday", "feb 30 rent 900"]) {
      expect(parseQuickAdd(text, TODAY)).toBeNull();
    }
  });
});
