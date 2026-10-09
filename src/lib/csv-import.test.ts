import { describe, expect, it } from "vitest";
import { DuplicateMatcher, duplicateKey } from "./csv-import";

describe("duplicateKey", () => {
  it("ignores title case and surrounding spaces, and the time of day", () => {
    expect(duplicateKey(new Date("2026-03-02T00:00:00Z"), 450, " Coffee ")).toBe(
      duplicateKey(new Date("2026-03-02T15:30:00Z"), 450, "coffee"),
    );
  });

  it("treats a missing title as empty", () => {
    expect(duplicateKey(new Date("2026-03-02T00:00:00Z"), 450, null)).toBe("2026-03-02|450|");
  });
});

describe("DuplicateMatcher", () => {
  it("lets each existing expense absorb one imported row", () => {
    const day = new Date("2026-03-02T00:00:00Z");
    const matcher = new DuplicateMatcher([
      { date: day, amountCents: 450, title: "Coffee" },
      { date: day, amountCents: 450, title: "Coffee" },
    ]);
    expect(matcher.claim(day, 450, "coffee")).toBe(true);
    expect(matcher.claim(day, 450, "coffee")).toBe(true);
    expect(matcher.claim(day, 450, "coffee")).toBe(false);
    expect(matcher.claim(day, 451, "Coffee")).toBe(false);
  });
});
