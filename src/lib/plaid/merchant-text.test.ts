import { describe, expect, it } from "vitest";
import { titleCaseMerchant } from "@/lib/plaid/merchant-text";

describe("titleCaseMerchant", () => {
  it("presents a stripped description as a name rather than a shout", () => {
    expect(titleCaseMerchant("SQ *BLUE BOTTLE #412 TORONTO ON")).toBe("Blue Bottle Toronto");
    expect(titleCaseMerchant("POS PURCHASE INTERAC LOBLAWS")).toBe("Loblaws");
    expect(titleCaseMerchant("TST* THE LOCAL PUB")).toBe("The Local Pub");
  });

  it("keeps digits that are part of a name", () => {
    expect(titleCaseMerchant("7-ELEVEN STORE")).toBe("7 Eleven Store");
  });

  it("returns nothing when there was nothing but noise", () => {
    expect(titleCaseMerchant("#### ****")).toBe("");
    expect(titleCaseMerchant(null)).toBe("");
    expect(titleCaseMerchant(undefined)).toBe("");
  });
});
