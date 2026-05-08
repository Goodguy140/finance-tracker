import { describe, expect, it } from "vitest";
import { parseExpenseAmountFromForm } from "./expense-amount";

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    formData.set(k, v);
  }
  return formData;
}

function fdWithMultiCredits(entries: Record<string, string>, credits: string[]) {
  const formData = fd(entries);
  formData.delete("creditTotal");
  for (const c of credits) {
    formData.append("creditTotal", c);
  }
  return formData;
}

describe("parseExpenseAmountFromForm", () => {
  it("parses a simple signed amount", () => {
    const r = parseExpenseAmountFromForm(fd({ amount: "-10.00", preCreditTotal: "", creditTotal: "" }));
    expect(r.amountCents).toBe(-1000);
    expect(r.preCreditCents).toBeNull();
    expect(r.creditCents).toBeNull();
    expect(r.creditBreakdownJson).toBeNull();
  });

  it("parses receipt breakdown into net and stored parts", () => {
    const r = parseExpenseAmountFromForm(fd({ amount: "", preCreditTotal: "100", creditTotal: "15.50" }));
    expect(r.amountCents).toBe(8450);
    expect(r.preCreditCents).toBe(10000);
    expect(r.creditCents).toBe(1550);
    expect(r.creditBreakdownJson).toBe("[1550]");
  });

  it("sums multiple credit rows in receipt breakdown", () => {
    const r = parseExpenseAmountFromForm(
      fdWithMultiCredits({ amount: "", preCreditTotal: "100" }, ["10.00", "5.50", ""]),
    );
    expect(r.amountCents).toBe(8450);
    expect(r.preCreditCents).toBe(10000);
    expect(r.creditCents).toBe(1550);
    expect(r.creditBreakdownJson).toBe("[1000,550]");
  });

  it("rejects credits without a total before credits", () => {
    expect(() => parseExpenseAmountFromForm(fd({ amount: "", preCreditTotal: "", creditTotal: "5" }))).toThrow();
  });
});
