import { describe, expect, it } from "vitest";
import { DuplicateMatcher, duplicateKey, statementOutflow } from "./csv-import";

describe("duplicateKey", () => {
  it("ignores title case and surrounding spaces, and the time of day", () => {
    expect(duplicateKey("acc", new Date("2026-03-02T00:00:00Z"), 450, " Coffee ")).toBe(
      duplicateKey("acc", new Date("2026-03-02T15:30:00Z"), 450, "coffee"),
    );
  });

  it("treats a missing title and a missing account as empty", () => {
    expect(duplicateKey(null, new Date("2026-03-02T00:00:00Z"), 450, null)).toBe("|2026-03-02|450|");
  });

  it("tells accounts apart", () => {
    const day = new Date("2026-03-02T00:00:00Z");
    expect(duplicateKey("visa", day, 450, "Coffee")).not.toBe(duplicateKey("debit", day, 450, "Coffee"));
    expect(duplicateKey("visa", day, 450, "Coffee")).not.toBe(duplicateKey(null, day, 450, "Coffee"));
  });
});

describe("DuplicateMatcher", () => {
  it("lets each existing expense absorb one imported row", () => {
    const day = new Date("2026-03-02T00:00:00Z");
    const matcher = new DuplicateMatcher([
      { accountId: "visa", date: day, amountCents: 450, title: "Coffee" },
      { accountId: "visa", date: day, amountCents: 450, title: "Coffee" },
    ]);
    expect(matcher.claim("visa", day, 450, "coffee")).toBe(true);
    expect(matcher.claim("visa", day, 450, "coffee")).toBe(true);
    expect(matcher.claim("visa", day, 450, "coffee")).toBe(false);
    expect(matcher.claim("visa", day, 451, "Coffee")).toBe(false);
  });

  it("keeps the same purchase on another account", () => {
    const day = new Date("2026-03-02T00:00:00Z");
    const matcher = new DuplicateMatcher([{ accountId: "visa", date: day, amountCents: 450, title: "Coffee" }]);
    expect(matcher.claim("debit", day, 450, "Coffee")).toBe(false);
    expect(matcher.claim(undefined, day, 450, "Coffee")).toBe(false);
    expect(matcher.claim("visa", day, 450, "Coffee")).toBe(true);
  });
});

describe("statementOutflow", () => {
  const parse = (raw: string) => (raw === "x" ? null : Number(raw.replace(/,/g, "")) || null);

  it("reads one amount column either way round", () => {
    expect(statementOutflow({ A: "12.5" }, { amount: "A" }, "spending-positive", parse)).toBe(12.5);
    expect(statementOutflow({ A: "-12.5" }, { amount: "A" }, "spending-negative", parse)).toBe(12.5);
    expect(statementOutflow({ A: "40" }, { amount: "A" }, "spending-negative", parse)).toBe(-40);
  });

  it("reads separate debit and credit columns as sizes, whatever sign the bank printed", () => {
    const columns = { amount: "Debit", amountIn: "Credit" };
    expect(statementOutflow({ Debit: "-9", Credit: "" }, columns, "spending-negative", parse)).toBe(9);
    expect(statementOutflow({ Debit: "", Credit: "1,000" }, columns, "spending-positive", parse)).toBe(-1000);
    expect(statementOutflow({ Debit: "", Credit: "" }, columns, "spending-positive", parse)).toBeNull();
  });

  it("is null for an amount it cannot read", () => {
    expect(statementOutflow({ A: "x" }, { amount: "A" }, "spending-positive", parse)).toBeNull();
    expect(statementOutflow({}, { amount: "A" }, "spending-positive", parse)).toBeNull();
  });
});
