import { describe, expect, it } from "vitest";
import { convertAmountCents, outflowCents, untransferredType } from "@/lib/transfer-type";

describe("transfer amounts", () => {
  it("expresses every type as money out", () => {
    expect(outflowCents("EXPENSE", 1200)).toBe(1200);
    expect(outflowCents("EXPENSE", -300)).toBe(-300); // a refund arrived
    expect(outflowCents("TRANSFER", -500)).toBe(-500);
    expect(outflowCents("INCOME", 5000)).toBe(-5000);
  });

  it("keeps the money the same when the type changes", () => {
    expect(convertAmountCents("EXPENSE", 40000, "TRANSFER")).toBe(40000);
    expect(convertAmountCents("INCOME", 40000, "TRANSFER")).toBe(-40000);
    expect(convertAmountCents("TRANSFER", -40000, "INCOME")).toBe(40000);
    expect(convertAmountCents("TRANSFER", 40000, "EXPENSE")).toBe(40000);
  });

  it("unmarks money out as an expense and money in as income", () => {
    expect(untransferredType(40000)).toBe("EXPENSE");
    expect(untransferredType(-40000)).toBe("INCOME");
  });
});
