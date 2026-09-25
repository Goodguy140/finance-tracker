import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_PCT,
  MIN_BUDGET_NAME_VISIBLE_PCT,
  MIN_TEXT_VISIBLE_PCT,
  parseVisiblePct,
} from "./dashboard-readability";

describe("parseVisiblePct", () => {
  it("accepts whole percentages within bounds, including both ends", () => {
    expect(parseVisiblePct("95", "Card text", MIN_TEXT_VISIBLE_PCT)).toBe(95);
    expect(parseVisiblePct(` ${MIN_TEXT_VISIBLE_PCT} `, "Card text", MIN_TEXT_VISIBLE_PCT)).toBe(MIN_TEXT_VISIBLE_PCT);
    expect(parseVisiblePct(String(MAX_VISIBLE_PCT), "Card text", MIN_TEXT_VISIBLE_PCT)).toBe(MAX_VISIBLE_PCT);
  });

  it("lets budget names go as low as 10% while card text stops at 50%", () => {
    expect(MIN_BUDGET_NAME_VISIBLE_PCT).toBe(10);
    expect(parseVisiblePct("10", "Budget names", MIN_BUDGET_NAME_VISIBLE_PCT)).toBe(10);
    expect(() => parseVisiblePct("9", "Budget names", MIN_BUDGET_NAME_VISIBLE_PCT)).toThrow(/from 10 to 100/);
    expect(() => parseVisiblePct("10", "Card text", MIN_TEXT_VISIBLE_PCT)).toThrow(/Card text must be .* from 50 to 100/);
  });

  it("rejects blanks, fractions, out-of-range values and junk, naming the field", () => {
    for (const bad of ["", "   ", null, undefined, "90.5", "49", "101", "-5", "abc", "1e2"]) {
      expect(() => parseVisiblePct(bad, "Card text", MIN_TEXT_VISIBLE_PCT)).toThrow(/Card text must be a whole number/);
    }
  });
});
