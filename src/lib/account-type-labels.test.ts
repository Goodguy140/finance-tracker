import { describe, expect, it } from "vitest";
import { formatAccountDetachedLabel, formatAccountTypeLabel } from "./account-type-labels";

describe("formatAccountTypeLabel", () => {
  it("maps known enum values to readable labels", () => {
    expect(formatAccountTypeLabel("CREDIT_CARD")).toBe("Credit card");
    expect(formatAccountTypeLabel("NON_REGISTERED")).toBe("Non-registered");
    expect(formatAccountTypeLabel("CHEQUING")).toBe("Chequing");
  });
});

describe("formatAccountDetachedLabel", () => {
  it("uses readable type in stored label", () => {
    expect(formatAccountDetachedLabel("Visa", "CREDIT_CARD")).toBe("Visa (Credit card)");
  });
});
