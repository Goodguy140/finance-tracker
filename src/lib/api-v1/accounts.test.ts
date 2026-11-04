import { describe, expect, it } from "vitest";
import type { AccountPage } from "@/lib/account-page-data";
import { dateFromYmd } from "@/lib/date-only";
import { registerMonths, serializeAccountPage, serializeNetWorth } from "./accounts";

function page(overrides: Partial<AccountPage> = {}, account: Partial<AccountPage["account"]> = {}): AccountPage {
  return {
    account: {
      id: "a1",
      name: "Visa",
      type: "CREDIT_CARD",
      currency: "CAD",
      archived: false,
      creditLimitCents: 500_000,
      paymentDueDay: 15,
      ...account,
    },
    liability: true,
    latest: { cents: 200_000, date: dateFromYmd("2026-10-31"), source: "PLAID" },
    history: [],
    register: [
      { id: "t2", date: dateFromYmd("2026-11-02"), title: "Groceries", type: "EXPENSE", inCents: -5_000, balanceCents: 205_000, afterReading: true },
      { id: "t1", date: dateFromYmd("2026-10-30"), title: "Payment", type: "TRANSFER", inCents: 40_000, balanceCents: 200_000, afterReading: false },
    ],
    registerMonths: 3,
    thisMonth: { inCents: 0, outCents: 5_000 },
    bank: null,
    waitingInQueue: 0,
    rules: [],
    goals: [],
    todayYmd: "2026-11-03",
    ...overrides,
  };
}

describe("serializeAccountPage", () => {
  it("gives a card its limit, how much of it is used and its due day", () => {
    expect(serializeAccountPage(page()).card).toEqual({
      limitCents: 500_000,
      utilization: { pct: 40, high: true },
      highPct: 30,
      dueDay: "the 15th",
    });
    expect(serializeAccountPage(page({}, { creditLimitCents: null, paymentDueDay: null })).card).toBeNull();
    expect(serializeAccountPage(page({ liability: false }, { type: "CHEQUING" })).card).toBeNull();
  });

  it("dates the register in days and keeps which rows no balance has confirmed", () => {
    const out = serializeAccountPage(page());
    expect(out.register.map((r) => [r.date, r.type, r.balanceCents, r.afterReading])).toEqual([
      ["2026-11-02", "expense", 205_000, true],
      ["2026-10-30", "transfer", 200_000, false],
    ]);
    expect(out.balance).toEqual({ cents: 200_000, date: "2026-10-31", source: "bank" });
    expect(out.account.typeLabel).not.toBe("CREDIT_CARD");
  });

  it("says what the bank needs, else why its last sync failed, else nothing", () => {
    const bank = { institutionName: "Tangerine", lastSyncedAt: new Date("2026-11-03T10:00:00Z"), lastSyncError: "ITEM_ERROR" };
    const attention = { kind: "reauth", message: "Tangerine needs you to sign in again.", action: "reauth", actionLabel: "Sign in" } as const;
    expect(serializeAccountPage(page({ bank: { ...bank, attention } })).bank?.problem).toBe("Tangerine needs you to sign in again.");
    expect(serializeAccountPage(page({ bank: { ...bank, attention: null } })).bank).toEqual({
      institutionName: "Tangerine",
      lastSyncedAt: "2026-11-03T10:00:00.000Z",
      problem: "The last sync failed: ITEM_ERROR",
    });
    expect(serializeAccountPage(page({ bank: { ...bank, lastSyncError: null, attention: null } })).bank?.problem).toBeNull();
  });
});

describe("serializeNetWorth", () => {
  it("lists each account's balance and whether the totals count it", () => {
    const out = serializeNetWorth({
      currency: "CAD",
      points: [{ ym: "2026-11", label: "Nov", assetsCents: 900_000, liabilitiesCents: 200_000, netCents: 700_000 }],
      assetsCents: 900_000,
      liabilitiesCents: 200_000,
      netCents: 700_000,
      accounts: [
        {
          accountId: "a2",
          name: "US savings",
          type: "SAVINGS",
          currency: "USD",
          liability: false,
          latest: { cents: 10_000, date: dateFromYmd("2026-10-01"), source: "MANUAL" },
          counted: false,
        },
        { accountId: "a3", name: "Brokerage", type: "INVESTMENT", currency: "CAD", liability: false, latest: null, counted: true },
      ],
    });
    expect(out.accounts).toMatchObject([
      { id: "a2", counted: false, balance: { cents: 10_000, date: "2026-10-01", source: "manual" } },
      { id: "a3", counted: true, balance: null },
    ]);
    expect(out.points).toEqual([{ ym: "2026-11", label: "Nov", netCents: 700_000 }]);
  });
});

describe("registerMonths", () => {
  it("takes 3 or 12, as the website does, and 3 otherwise", () => {
    expect(registerMonths("12")).toBe(12);
    expect(registerMonths("3")).toBe(3);
    expect(registerMonths("600")).toBe(3);
    expect(registerMonths(null)).toBe(3);
  });
});
