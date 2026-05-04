import { describe, expect, it } from "vitest";
import { mergeAccountDescriptionOnDetach } from "./transaction-account-detach";

describe("mergeAccountDescriptionOnDetach", () => {
  it("uses removed label when no existing description", () => {
    expect(mergeAccountDescriptionOnDetach(null, "Visa (Credit card)")).toBe("Visa (Credit card)");
    expect(mergeAccountDescriptionOnDetach("  ", "Chequing (Chequing)")).toBe("Chequing (Chequing)");
  });

  it("appends removed label when description exists", () => {
    expect(mergeAccountDescriptionOnDetach("Imported memo", "Visa (Credit card)")).toBe(
      "Imported memo · Visa (Credit card)",
    );
  });
});
