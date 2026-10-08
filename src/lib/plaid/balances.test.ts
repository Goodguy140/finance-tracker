import { describe, expect, it } from "vitest";
import { balanceReadings } from "./balances";

const mapped = new Map([
  ["p-chq", { accountId: "chq", syncEnabled: true }],
  ["p-card", { accountId: "card", syncEnabled: true }],
  ["p-off", { accountId: "off", syncEnabled: false }],
  ["p-unmapped", { accountId: null, syncEnabled: true }],
]);
const acct = (account_id: string, current: number | null | undefined) => ({
  account_id,
  name: account_id,
  type: "depository",
  balances: current === undefined ? undefined : { current, available: 1 },
});

describe("balanceReadings", () => {
  it("takes `current` in cents for mapped, syncing accounts only", () => {
    expect(
      balanceReadings(
        [acct("p-chq", 1234.565), acct("p-card", 250), acct("p-off", 5), acct("p-unmapped", 5), acct("p-unknown", 5)],
        mapped,
      ),
    ).toEqual([
      { accountId: "chq", balanceCents: 123457 },
      { accountId: "card", balanceCents: 25000 },
    ]);
  });

  it("records nothing for a balance Plaid could not resolve", () => {
    expect(balanceReadings([acct("p-chq", null), acct("p-card", undefined)], mapped)).toEqual([]);
  });
});
