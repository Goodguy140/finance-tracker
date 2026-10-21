import { describe, expect, it } from "vitest";
import { currencyChangeRefusal, foreignAccountDeleteRefusal, type AccountUsage } from "./account-currency-guard";

const unused: AccountUsage = { transactions: 0, recurringRules: 0, balanceSnapshots: 0, plaidMapped: false };
const account = { name: "Visa", currency: "USD" };

describe("currencyChangeRefusal", () => {
  it("allows a change on an account with nothing recorded", () => {
    expect(currencyChangeRefusal(account, "CAD", unused)).toBeNull();
  });

  it("allows saving the same currency, whatever the account holds", () => {
    expect(currencyChangeRefusal(account, "usd", { ...unused, transactions: 5 })).toBeNull();
  });

  it.each<[string, Partial<AccountUsage>, string]>([
    ["transactions", { transactions: 2 }, "2 transactions"],
    ["recurring rules", { recurringRules: 1 }, "1 recurring rule"],
    ["balances", { balanceSnapshots: 3 }, "3 balances"],
    ["a Plaid mapping", { plaidMapped: true }, "a linked bank account"],
  ])("refuses when the account has %s", (_label, usage, named) => {
    const refusal = currencyChangeRefusal(account, "CAD", { ...unused, ...usage });
    expect(refusal).toContain(named);
    expect(refusal).toContain("in USD");
  });
});

describe("foreignAccountDeleteRefusal", () => {
  it("refuses a non-home-currency account that has transactions", () => {
    expect(foreignAccountDeleteRefusal(account, "CAD", 1)).toContain("count as CAD");
  });

  it("allows a home-currency account, or one with no transactions", () => {
    expect(foreignAccountDeleteRefusal({ name: "Chequing", currency: "CAD" }, "CAD", 10)).toBeNull();
    expect(foreignAccountDeleteRefusal(account, "CAD", 0)).toBeNull();
  });
});
