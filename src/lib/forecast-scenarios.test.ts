import { describe, expect, it } from "vitest";
import { dateFromYmd } from "./date-only";
import { applyScenario, SCENARIO_DAYS } from "./forecast-scenarios";
import { projectBalances, type ProjectableRule } from "./projected-balances";
import type { AccountBalanceRow } from "./net-worth";

const accounts: AccountBalanceRow[] = [
  {
    accountId: "chq",
    name: "Chequing",
    type: "CHEQUING",
    currency: "CAD",
    liability: false,
    latest: { cents: 100_000, date: dateFromYmd("2026-10-01"), source: "SNAPSHOT" as never },
    counted: true,
  },
];

const rules: ProjectableRule[] = [
  {
    id: "pay",
    name: "Pay",
    type: "INCOME",
    amountCents: 300_000,
    cadence: "MONTHLY",
    nextExpectedDate: dateFromYmd("2026-11-01"),
    anchorDay: 1,
    endDate: null,
    enabled: true,
    accountId: "chq",
  },
  {
    id: "gym",
    name: "Gym",
    type: "EXPENSE",
    amountCents: 5_000,
    cadence: "MONTHLY",
    nextExpectedDate: dateFromYmd("2026-11-05"),
    anchorDay: 5,
    endDate: null,
    enabled: true,
    accountId: "chq",
  },
];

const net = (r: readonly ProjectableRule[]) =>
  projectBalances({ accounts, rules: r, todayYmd: "2026-10-25", currentYm: "2026-10", days: SCENARIO_DAYS }).netCents;

describe("applyScenario", () => {
  it("adds a new bill from its start date", () => {
    const changed = applyScenario(rules, [
      { kind: "add", name: "Car", type: "EXPENSE", amountCents: 60_000, cadence: "MONTHLY", startYmd: "2027-01-15", accountId: "chq" },
    ]);
    const [, d30, d90] = net(changed);
    const [, b30, b90] = net(rules);
    // Not yet in 30 days; one payment (Jan 15) by the 90-day mark, Jan 23.
    expect(d30).toBe(b30);
    expect(b90 - d90).toBe(60_000);
  });

  it("removes rules by id", () => {
    const changed = applyScenario(rules, [{ kind: "remove", ruleIds: ["gym"] }]);
    expect(changed.map((r) => r.id)).toEqual(["pay"]);
    const [, , d90] = net(changed);
    const [, , b90] = net(rules);
    // Gym on Nov 5, Dec 5, Jan 5.
    expect(d90 - b90).toBe(15_000);
  });

  it("raises income only from the given date", () => {
    const changed = applyScenario(rules, [{ kind: "income", pct: 10, fromYmd: "2026-12-15" }]);
    const pay = changed.filter((r) => r.name === "Pay");
    expect(pay).toHaveLength(2);
    expect(pay[0].endDate).toEqual(dateFromYmd("2026-12-14"));
    expect(pay[1]).toMatchObject({ amountCents: 330_000, nextExpectedDate: dateFromYmd("2027-01-01") });
    const [, d30, d90] = net(changed);
    const [, b30, b90] = net(rules);
    expect(d30).toBe(b30);
    // Only Jan 1 is at the new amount within 90 days.
    expect(d90 - b90).toBe(30_000);
  });

  it("leaves the rules alone with no changes", () => {
    expect(applyScenario(rules, [])).toEqual(rules);
  });
});
