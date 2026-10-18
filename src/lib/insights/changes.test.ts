import { describe, expect, it } from "vitest";
import { detectChanges } from "./changes";
import { NOW, tx } from "./test-fixtures";
import type { InsightRecurringRule, InsightTx } from "./types";
import { moneyFormatter } from "./util";

// NOW is 2026-09-25.
const fmt = moneyFormatter();
const run = (txs: InsightTx[], rules: InsightRecurringRule[] = []) => detectChanges({ txs, rules, now: NOW, fmt });
const pay = (date: string, cents = 210_000) => tx(date, "Acme Payroll", cents, { type: "INCOME", categoryId: "s", categoryName: "Salary" });

describe("pay", () => {
  it("says when pay that comes every month has not come", () => {
    const [missed] = run(["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15"].map((d) => pay(d)));
    expect(missed).toMatchObject({ key: "pay:missed:acme payroll:2026-09-15", section: "ahead", severity: "high" });
    expect(missed.title).toBe("No pay from Acme Payroll since Aug 15");
  });

  it("waits out a few days' grace, and gives up once it has plainly stopped", () => {
    expect(run(["2026-06-21", "2026-07-21", "2026-08-21"].map((d) => pay(d)))).toEqual([]);
    expect(run(["2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15"].map((d) => pay(d)))).toEqual([]);
  });

  it("says when the latest pay came in well short of the usual", () => {
    const txs = [...["2026-06-15", "2026-07-15", "2026-08-15"].map((d) => pay(d)), pay("2026-09-15", 170_000)];
    const [short] = run(txs);
    expect(short).toMatchObject({ key: "pay:short:acme payroll:2026-09-15", severity: "medium" });
    expect(short.title).toBe(`Pay from Acme Payroll came in ${fmt(40_000)} short`);
    // A small wobble is not news.
    expect(run([...txs.slice(0, 3), pay("2026-09-15", 205_000)])).toEqual([]);
  });
});

describe("a recurring entry whose charges stopped", () => {
  const rule: InsightRecurringRule = { id: "r1", name: "Gymbox", type: "EXPENSE", amountCents: 4500, cadence: "MONTHLY", enabled: true, categoryId: "c" };
  const charge = (date: string) => tx(date, "Gymbox", 4500, { recurringTransactionId: "r1" });

  it("suggests turning the entry off once 1.5 cycles pass with no charge", () => {
    const [stopped] = run(["2026-05-02", "2026-06-02", "2026-07-02"].map(charge), [rule]);
    expect(stopped).toMatchObject({ key: "rule:stopped:r1:2026-07-02", section: "recurring" });
    expect(stopped.body).toContain("last charge was on Jul 2");
  });

  it("says nothing while charges keep coming, or for an entry that is off", () => {
    expect(run(["2026-07-02", "2026-08-02", "2026-09-02"].map(charge), [rule])).toEqual([]);
    expect(run(["2026-05-02", "2026-06-02", "2026-07-02"].map(charge), [{ ...rule, enabled: false }])).toEqual([]);
  });
});

describe("a new subscription", () => {
  it("notes a service charged for the first time this month", () => {
    const [found] = run([tx("2026-09-03", "NETFLIX.COM", 1699)]);
    expect(found).toMatchObject({ key: "subscription:new:Netflix:2026-09-03", title: "New: Netflix", annualCents: 1699 * 12 });
  });

  it("calls out a trial price turning into the full one", () => {
    const [found] = run([tx("2026-08-25", "Spotify", 99), tx("2026-09-24", "Spotify", 1199)]);
    expect(found.title).toBe(`Spotify went from ${fmt(99)} to ${fmt(1199)}`);
  });

  it("leaves a service paid for a while alone", () => {
    expect(run([tx("2026-07-03", "NETFLIX.COM", 1699), tx("2026-08-03", "NETFLIX.COM", 1699), tx("2026-09-03", "NETFLIX.COM", 1699)])).toEqual([]);
  });
});

describe("an unusually large charge at a regular merchant", () => {
  const hydro = (date: string, cents: number) => tx(date, "Hydro One", cents);
  const usual = [hydro("2026-04-10", 11_000), hydro("2026-05-10", 12_000), hydro("2026-06-10", 13_000), hydro("2026-07-10", 12_500)];

  it("flags a bill far above anything before it", () => {
    const [big] = run([...usual, hydro("2026-08-10", 12_000), hydro("2026-09-10", 31_000)]);
    expect(big).toMatchObject({ section: "saving", severity: "medium" });
    expect(big.title).toBe(`Hydro One ${fmt(31_000)}, usually about ${fmt(12_000)}`);
  });

  it("ignores a seasonal rise and a store visited now and then", () => {
    expect(run([...usual, hydro("2026-08-10", 12_000), hydro("2026-09-10", 18_000)])).toEqual([]);
    const shop = ["2026-04-02", "2026-04-09", "2026-06-20", "2026-07-01", "2026-08-30"].map((d) => tx(d, "Costco", 9_000));
    expect(run([...shop, tx("2026-09-20", "Costco", 30_000)])).toEqual([]);
  });
});
