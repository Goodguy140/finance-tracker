import { describe, expect, it, vi } from "vitest";
import { NOW, tx } from "./test-fixtures";
import type { InsightTx } from "./types";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { detectDataGaps, findQuietStretch, findScheduleGaps } = await import("./gaps");
const { moneyFormatter } = await import("./util");

const fmt = moneyFormatter();
const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** `count` dates `stepDays` apart, the last on `lastYmd`. */
function every(stepDays: number, count: number, lastYmd: string): string[] {
  const last = d(lastYmd).getTime();
  return Array.from({ length: count }, (_, i) => new Date(last - (count - 1 - i) * stepDays * 86_400_000).toISOString().slice(0, 10));
}

const pay = (dates: string[], title = "ACME PAYROLL", cents = 210_000) =>
  dates.map((date) => tx(date, title, cents, { type: "INCOME", categoryId: "cat-pay", categoryName: "Salary", accountId: "chq" }));

const accounts = [
  { id: "chq", name: "Chequing", type: "CHEQUING", countsAsSavings: false },
  { id: "sav", name: "Savings", type: "SAVINGS", countsAsSavings: true },
  { id: "visa", name: "Visa", type: "CREDIT_CARD", countsAsSavings: false },
];

function transfer(date: string, amountCents: number, accountId: string, transferAccountId: string | null, paired = false) {
  return {
    ...tx(date, "Online transfer", amountCents, { type: "TRANSFER", accountId, categoryId: "cat-xfer", categoryName: "Transfers" }),
    transferAccountId,
    paired,
  };
}

const run = (input: Partial<Parameters<typeof detectDataGaps>[0]>) =>
  detectDataGaps({ txs: [], transfers: [], accounts, now: NOW, fmt, ...input });

describe("findScheduleGaps", () => {
  it("finds the paycheque missing between two that were logged", () => {
    const dates = every(14, 12, "2026-09-18").filter((ymd) => ymd !== "2026-08-07");
    const gaps = findScheduleGaps(dates.map(d), NOW);
    expect(gaps?.overdue).toBe(false);
    expect(gaps?.missed.map((m) => m.toISOString().slice(0, 10))).toEqual(["2026-08-07"]);
  });

  it("says nothing about a series with every occurrence logged", () => {
    expect(findScheduleGaps(every(14, 12, "2026-09-18").map(d), NOW)).toBeNull();
  });

  it("does not take one late arrival for a missing one", () => {
    const dates = every(30, 8, "2026-09-15");
    dates[5] = "2026-08-01"; // due mid-July, landed two weeks late
    expect(findScheduleGaps(dates.map(d), NOW)).toBeNull();
  });

  it("flags a series past its due date, but not one that ended long ago", () => {
    const overdue = findScheduleGaps(every(14, 10, "2026-08-21").map(d), NOW);
    expect(overdue?.overdue).toBe(true);
    expect(overdue?.missed[0].toISOString().slice(0, 10)).toBe("2026-09-04");
    expect(findScheduleGaps(every(14, 10, "2026-06-01").map(d), NOW)).toBeNull();
  });

  it("ignores holes older than the lookback", () => {
    const dates = every(30, 12, "2026-09-15").filter((_, i) => i !== 2);
    expect(findScheduleGaps(dates.map(d), NOW)).toBeNull();
  });
});

describe("detectDataGaps — income", () => {
  it("raises a missing paycheque, keyed by the date it was due", () => {
    const txs = pay(every(14, 12, "2026-09-18").filter((ymd) => ymd !== "2026-08-07"));
    const [gap] = run({ txs });
    expect(gap.section).toBe("gap");
    expect(gap.key).toBe("gap:income:acme payroll:2026-08-07");
    expect(gap.severity).toBe("high");
    expect(gap.title).toBe("ACME PAYROLL: one looks missing");
    expect(gap.body).toContain("every two weeks");
    expect(gap.body).toContain("Aug 7");
    expect(gap.action).toEqual({ kind: "link", href: "/?month=2026-08", label: "Open that month" });
  });

  it("leaves late pay to the pay:missed insight, but still names an earlier hole", () => {
    // Biweekly to Aug 21 — late by NOW — with Jul 24 never logged.
    const dates = every(14, 10, "2026-08-21").filter((ymd) => ymd !== "2026-07-24");
    const gaps = run({ txs: pay(dates) });
    expect(gaps.map((g) => g.key)).toEqual(["gap:income:acme payroll:2026-07-24"]);
    expect(run({ txs: pay(every(14, 10, "2026-08-21")) })).toEqual([]);
  });

  it("says nothing when every paycheque is there", () => {
    expect(run({ txs: pay(every(14, 12, "2026-09-18")) })).toEqual([]);
  });

  it("flags a month with no income at all for irregular earners", () => {
    const freelance = ["2026-03-04", "2026-04-20", "2026-05-11", "2026-06-02", "2026-08-27"].map((date, i) =>
      tx(date, `Invoice ${["alpha", "bravo", "charlie", "delta", "echo"][i]}`, 150_000 + i * 10_000, { type: "INCOME" }),
    );
    const gaps = run({ txs: freelance });
    expect(gaps.map((g) => g.key)).toEqual(["gap:income-month:2026-07"]);
    expect(gaps[0].title).toBe("No income logged in July 2026");
  });

  it("leaves a month to the missing-paycheque insight that explains it", () => {
    // Monthly salary, August's never logged: one insight, not a second "no income in August".
    const gaps = run({ txs: pay(every(30.4, 10, "2026-09-15").filter((ymd) => !ymd.startsWith("2026-08"))) });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].key.startsWith("gap:income:")).toBe(true);
  });
});

describe("detectDataGaps — transfers", () => {
  const monthly = every(30.4, 10, "2026-09-01").filter((ymd) => !ymd.startsWith("2026-07"));

  it("flags a missed savings transfer", () => {
    const gaps = run({ transfers: monthly.map((date) => transfer(date, 50_000, "chq", "sav")) });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].key).toMatch(/^gap:saving:chq>sav:2026-07-/);
    expect(gaps[0].title).toBe("Savings transfers to Savings: one looks missing");
  });

  it("counts a transfer logged on both sides once", () => {
    // The arriving leg posts a day later, as it often does at a second bank.
    const nextDay = (ymd: string) => new Date(d(ymd).getTime() + 86_400_000).toISOString().slice(0, 10);
    const both = monthly.flatMap((date) => [
      transfer(date, 50_000, "chq", "sav", true),
      transfer(nextDay(date), -50_000, "sav", "chq", true),
    ]);
    const gaps = run({ transfers: both });
    expect(gaps.map((g) => g.key.split(":").slice(0, 3).join(":"))).toEqual(["gap:saving:chq>sav"]);
  });

  it("calls a transfer to a card a payment", () => {
    const gaps = run({ transfers: monthly.map((date) => transfer(date, 80_000, "chq", "visa")) });
    expect(gaps[0].title).toBe("Payments to Visa: one looks missing");
  });

  it("ignores transfers to an archived account", () => {
    expect(run({ transfers: monthly.map((date) => transfer(date, 50_000, "chq", "gone")) })).toEqual([]);
  });
});

describe("findQuietStretch", () => {
  const busy = (from: string, to: string) => {
    const out: Date[] = [];
    for (let t = d(from).getTime(); t <= d(to).getTime(); t += 2 * 86_400_000) out.push(new Date(t));
    return out;
  };

  it("finds a silence between two busy stretches", () => {
    const stretch = findQuietStretch([...busy("2026-03-01", "2026-07-20"), ...busy("2026-08-25", "2026-09-24")], NOW);
    expect(stretch?.from.toISOString().slice(0, 10)).toBe("2026-07-19");
    expect(stretch?.to?.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("finds a silence that is still going", () => {
    const stretch = findQuietStretch(busy("2026-03-01", "2026-08-20"), NOW);
    expect(stretch?.to).toBeNull();
    expect(stretch?.days).toBeGreaterThanOrEqual(21);
  });

  it("leaves a steadily used account alone, and one retired long ago", () => {
    expect(findQuietStretch(busy("2026-03-01", "2026-09-24"), NOW)).toBeNull();
    expect(findQuietStretch(busy("2025-09-01", "2026-04-01"), NOW)).toBeNull();
  });
});

describe("detectDataGaps — quiet accounts", () => {
  it("names the account and links to import", () => {
    const txs: InsightTx[] = [];
    for (let t = d("2026-03-01").getTime(); t <= d("2026-08-20").getTime(); t += 2 * 86_400_000) {
      txs.push(tx(new Date(t).toISOString().slice(0, 10), "Coffee", 500, { accountId: "visa" }));
    }
    const gaps = run({ txs }).filter((g) => g.key.startsWith("gap:quiet:"));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].title).toMatch(/^Nothing logged for Visa since Aug /);
    expect(gaps[0].action).toEqual({ kind: "link", href: "/settings/import", label: "Import transactions" });
  });
});
