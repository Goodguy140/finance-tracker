import { describe, expect, it } from "vitest";
import { dateFromYmd } from "@/lib/date-only";
import { computeGoalProgress, monthlyPaceCents, monthlyTransferPaceCents, monthsUntil } from "./savings-goals";

const r = (ymd: string, cents: number) => ({ date: dateFromYmd(ymd), cents });
const TODAY = "2026-10-12";
const linked = { accountId: "a1", savedCents: 0 };

describe("monthsUntil", () => {
  it("counts to the nearest month and never says zero", () => {
    expect(monthsUntil(TODAY, "2026-10-12")).toBe(1);
    expect(monthsUntil(TODAY, "2026-10-20")).toBe(1);
    expect(monthsUntil(TODAY, "2026-11-12")).toBe(1);
    expect(monthsUntil(TODAY, "2026-12-12")).toBe(2);
    // A year and a day is still twelve months, not thirteen.
    expect(monthsUntil("2026-10-11", "2027-10-12")).toBe(12);
    expect(monthsUntil(TODAY, "2027-10-12")).toBe(12);
  });
  it("is null once the date has passed", () => {
    expect(monthsUntil(TODAY, "2026-10-11")).toBeNull();
  });
});

describe("monthlyPaceCents", () => {
  it("measures growth against the reading about three months back", () => {
    // Older readings than the window are ignored: 1,000 a month over the last ~91 days.
    const readings = [r("2025-01-01", 0), r("2026-07-13", 500_000), r("2026-10-12", 800_000)];
    const pace = monthlyPaceCents(readings, TODAY);
    expect(pace).toBeGreaterThan(99_000);
    expect(pace).toBeLessThan(101_000);
  });
  it("says nothing with under four weeks of history", () => {
    expect(monthlyPaceCents([r("2026-09-20", 0), r("2026-10-10", 50_000)], TODAY)).toBeNull();
    expect(monthlyPaceCents([r("2026-10-10", 50_000)], TODAY)).toBeNull();
  });
  it("ignores readings dated after today", () => {
    expect(monthlyPaceCents([r("2026-07-12", 0), r("2026-10-12", 30_000), r("2026-12-01", 9_000_000)], TODAY)).toBeLessThan(
      11_000,
    );
  });
  it("can be negative when the balance shrank", () => {
    expect(monthlyPaceCents([r("2026-07-12", 300_000), r("2026-10-12", 0)], TODAY)).toBeLessThan(0);
  });
});

describe("monthlyTransferPaceCents", () => {
  it("averages net transfers over the last three months", () => {
    // 500 a month for a year; only the last ~90 days count, and one withdrawal comes off.
    const monthly = Array.from({ length: 12 }, (_, i) => r(`2026-${String(i + 1).padStart(2, "0")}-01`, 50_000).date);
    const transfers = [...monthly.map((date) => ({ date, cents: 50_000 })), r("2026-09-15", -30_000)];
    // Jul 14 – Oct 12: Aug, Sep and Oct's 500s, less 300.
    const pace = monthlyTransferPaceCents(transfers, TODAY);
    expect(pace).toBeGreaterThan(40_000);
    expect(pace).toBeLessThan(41_000);
  });
  it("measures from the first transfer when that is more recent", () => {
    const pace = monthlyTransferPaceCents([r("2026-08-12", 60_000), r("2026-09-12", 60_000)], TODAY);
    // 1,200 over the ~61 days since Aug 12.
    expect(pace).toBeGreaterThan(59_000);
    expect(pace).toBeLessThan(61_000);
  });
  it("says nothing from a single transfer or under four weeks of them", () => {
    expect(monthlyTransferPaceCents([r("2026-07-01", 60_000)], TODAY)).toBeNull();
    expect(monthlyTransferPaceCents([r("2026-09-20", 60_000), r("2026-10-05", 60_000)], TODAY)).toBeNull();
  });
  it("ignores transfers dated after today", () => {
    expect(monthlyTransferPaceCents([r("2026-08-12", 60_000), r("2026-10-20", 60_000)], TODAY)).toBeNull();
  });
});

describe("computeGoalProgress", () => {
  const sparseBalance = [r("2026-10-01", 200_000)];
  const transfers = [r("2026-07-15", 50_000), r("2026-08-15", 50_000), r("2026-09-15", 50_000)];

  it("estimates a completion date from transfers when the balance has too few readings, with no target date", () => {
    const p = computeGoalProgress({ ...linked, targetCents: 700_000, targetDate: null }, sparseBalance, TODAY, transfers);
    expect(p.status).toBe("open");
    expect(p.monthlyPaceCents).toBeNull();
    expect(p.paceSource).toBe("transfers");
    // 5,000 to go at about 500 a month: about ten months out.
    expect(p.projectedYmd! > "2027-07-01").toBe(true);
    expect(p.projectedYmd! < "2027-09-01").toBe(true);
  });

  it("judges a dated goal by the transfer pace when that is all there is", () => {
    const p = computeGoalProgress(
      { ...linked, targetCents: 700_000, targetDate: dateFromYmd("2027-04-12") },
      sparseBalance,
      TODAY,
      transfers,
    );
    // 5,000 over 6 months needs ~834 a month; ~500 a month is behind.
    expect(p.status).toBe("behind");
  });

  it("prefers the balance's growth over transfers when it has enough readings", () => {
    const p = computeGoalProgress(
      { ...linked, targetCents: 1_000_000, targetDate: null },
      [r("2026-07-12", 100_000), r("2026-10-12", 400_000)],
      TODAY,
      transfers,
    );
    expect(p.paceSource).toBe("balance");
    expect(p.monthlyTransferCents).not.toBeNull();
  });

  it("gives no estimate for a hand-tracked goal", () => {
    const p = computeGoalProgress({ targetCents: 200_000, targetDate: null, accountId: null, savedCents: 50_000 }, [], TODAY, transfers);
    expect(p.paceSource).toBeNull();
    expect(p.projectedYmd).toBeNull();
  });

  it("uses the linked account's latest balance, not the hand-recorded amount", () => {
    const p = computeGoalProgress(
      { targetCents: 1_000_000, targetDate: null, accountId: "a1", savedCents: 999_999 },
      [r("2026-01-01", 100_000), r("2026-10-01", 250_000)],
      TODAY,
    );
    expect(p.savedCents).toBe(250_000);
    expect(p.fraction).toBe(0.25);
    expect(p.remainingCents).toBe(750_000);
    expect(p.status).toBe("open");
  });

  it("uses the hand-recorded amount without an account, with no pace", () => {
    const p = computeGoalProgress({ targetCents: 200_000, targetDate: dateFromYmd("2027-04-12"), accountId: null, savedCents: 50_000 }, [], TODAY);
    expect(p.savedCents).toBe(50_000);
    expect(p.monthlyPaceCents).toBeNull();
    expect(p.status).toBe("needs");
    // 1,500 to go over the 6 months from Oct 12 to Apr 12.
    expect(p.monthsLeft).toBe(6);
    expect(p.monthlyNeededCents).toBe(25_000);
  });

  it("is on track when the recent pace covers what the date needs", () => {
    const p = computeGoalProgress(
      { ...linked, targetCents: 1_000_000, targetDate: dateFromYmd("2027-10-12") },
      [r("2026-07-12", 100_000), r("2026-10-12", 400_000)],
      TODAY,
    );
    // 6,000 to go over 12 months needs 500 a month; it has been growing ~1,000 a month.
    expect(p.monthlyNeededCents).toBe(50_000);
    expect(p.status).toBe("on-track");
    expect(p.projectedYmd! < "2027-10-12").toBe(true);
  });

  it("is behind when the pace falls short", () => {
    const p = computeGoalProgress(
      { ...linked, targetCents: 1_000_000, targetDate: dateFromYmd("2027-01-12") },
      [r("2026-07-12", 100_000), r("2026-10-12", 130_000)],
      TODAY,
    );
    expect(p.status).toBe("behind");
  });

  it("is reached once the balance meets the target, whatever the date", () => {
    const p = computeGoalProgress(
      { ...linked, targetCents: 100_000, targetDate: dateFromYmd("2026-01-01") },
      [r("2026-10-01", 120_000)],
      TODAY,
    );
    expect(p.status).toBe("reached");
    expect(p.fraction).toBe(1);
    expect(p.monthlyNeededCents).toBeNull();
  });

  it("is overdue when the date passed short of the target", () => {
    const p = computeGoalProgress(
      { targetCents: 100_000, targetDate: dateFromYmd("2026-09-30"), accountId: null, savedCents: 40_000 },
      [],
      TODAY,
    );
    expect(p.status).toBe("overdue");
    expect(p.remainingCents).toBe(60_000);
  });

  it("waits for a balance when the linked account has none", () => {
    const p = computeGoalProgress({ ...linked, targetCents: 100_000, targetDate: null }, [], TODAY);
    expect(p.status).toBe("no-balance");
    expect(p.savedCents).toBeNull();
    expect(p.fraction).toBe(0);
  });
});
