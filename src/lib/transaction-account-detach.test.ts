import { describe, expect, it } from "vitest";
import { mergeAccountDescriptionOnDetach } from "./transaction-account-detach";

describe("mergeAccountDescriptionOnDetach", () => {
  it("uses removed label when no existing description", () => {
    expect(mergeAccountDescriptionOnDetach(null, "Visa (CREDIT_CARD)")).toBe("Visa (CREDIT_CARD)");
    expect(mergeAccountDescriptionOnDetach("  ", "Chequing (CHEQUING)")).toBe("Chequing (CHEQUING)");
  });

  it("appends removed label when description exists", () => {
    expect(mergeAccountDescriptionOnDetach("Imported memo", "Visa (CREDIT_CARD)")).toBe(
      "Imported memo · Visa (CREDIT_CARD)",
    );
  });
});
