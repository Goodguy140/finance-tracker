import { describe, expect, it } from "vitest";
import { computeNetWorth, type BalanceReading, type NetWorthAccount } from "./net-worth";

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const accounts: NetWorthAccount[] = [
  { id: "chq", name: "Chequing", type: "CHEQUING", currency: "CAD", archived: false },
  { id: "tfsa", name: "TFSA", type: "TFSA", currency: "CAD", archived: false },
  { id: "card", name: "Visa", type: "CREDIT_CARD", currency: "CAD", archived: false },
  { id: "mortgage", name: "Mortgage", type: "LOAN", currency: "CAD", archived: false },
  { id: "usd", name: "US account", type: "CHEQUING", currency: "USD", archived: false },
  { id: "old", name: "Closed", type: "SAVINGS", currency: "CAD", archived: true },
  { id: "cash", name: "Cash", type: "CASH", currency: "CAD", archived: false },
];
const r = (accountId: string, ymd: string, cents: number, source: BalanceReading["source"] = "PLAID"): BalanceReading => ({
  accountId,
  date: d(ymd),
  cents,
  source,
});

function compute(readings: BalanceReading[]) {
  return computeNetWorth({ accounts, readings, months: ["2026-07", "2026-08", "2026-09", "2026-10"], todayYmd: "2026-10-08", currency: "CAD" });
}

describe("computeNetWorth", () => {
  it("subtracts cards and loans, carries readings forward, and skips months before any reading", () => {
    const nw = compute([
      r("chq", "2026-08-10", 500_000),
      r("chq", "2026-09-30", 600_000),
      r("card", "2026-08-15", 50_000),
      r("mortgage", "2026-08-01", 30_000_000, "MANUAL"),
      r("tfsa", "2026-09-01", 1_000_000, "PORTFOLIO"),
    ]);
    expect(nw.points.map((p) => [p.ym, p.assetsCents, p.liabilitiesCents, p.netCents])).toEqual([
      ["2026-08", 500_000, 30_050_000, -29_550_000],
      ["2026-09", 1_600_000, 30_050_000, -28_450_000],
      ["2026-10", 1_600_000, 30_050_000, -28_450_000],
    ]);
    expect(nw.netCents).toBe(-28_450_000);
  });

  it("measures the running month as of today, not its end", () => {
    const nw = compute([r("chq", "2026-10-01", 100_000), r("chq", "2026-10-20", 900_000)]);
    expect(nw.points.at(-1)?.netCents).toBe(100_000);
    expect(nw.accounts.find((a) => a.accountId === "chq")?.latest?.cents).toBe(100_000);
  });

  it("leaves out archived accounts and other currencies, but still lists the latter", () => {
    const nw = compute([r("chq", "2026-09-01", 100_000), r("usd", "2026-09-01", 999_999), r("old", "2026-09-01", 777_777)]);
    expect(nw.netCents).toBe(100_000);
    expect(nw.accounts.find((a) => a.accountId === "usd")).toMatchObject({ counted: false, latest: { cents: 999_999 } });
    expect(nw.accounts.some((a) => a.accountId === "old")).toBe(false);
  });

  it("prefers a balance over a portfolio snapshot on the same day, and lists unbalanced accounts last", () => {
    const nw = compute([r("tfsa", "2026-09-01", 1_000, "PORTFOLIO"), r("tfsa", "2026-09-01", 2_000, "MANUAL")]);
    expect(nw.netCents).toBe(2_000);
    expect(nw.accounts[0].accountId).toBe("tfsa");
    expect(nw.accounts.at(-1)?.latest).toBeNull();
  });
});
