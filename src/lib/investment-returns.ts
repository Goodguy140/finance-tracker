import { dateFromYmd } from "@/lib/date-only";

/**
 * How investment accounts did: value now, what was put in, the growth in dollars, and the
 * money-weighted return (XIRR) over a window.
 *
 * The cash flows are the money that moved in or out from outside: contributions and withdrawals
 * recorded on the Investments card, and transfers in or out of the account that are not already
 * one of those (a transfer counted toward room is the same money as its contribution). Anything
 * else, dividends and fees included, is part of how the investments did.
 *
 * A value reading (a portfolio snapshot or a balance) on day D is taken to include the flows of
 * day D, so a window starts from the latest reading on or before its first day and counts the
 * flows after it, up to the latest reading. An account first valued inside the window starts
 * from that first value, as though the money arrived that day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365;

export type CashFlow = { date: Date; cents: number };

/**
 * The annual rate at which these flows net to zero, from the investor's side (money put in is
 * negative, money taken out and the value at the end positive). Null when there is no answer:
 * all flows one sign, or no convergence.
 */
export function xirr(flows: readonly CashFlow[]): number | null {
  if (flows.length < 2) return null;
  if (!flows.some((f) => f.cents > 0) || !flows.some((f) => f.cents < 0)) return null;
  const t0 = Math.min(...flows.map((f) => f.date.getTime()));
  const terms = flows.map((f) => ({ years: (f.date.getTime() - t0) / DAY_MS / YEAR_DAYS, cents: f.cents }));
  const npv = (rate: number) => terms.reduce((sum, t) => sum + t.cents / Math.pow(1 + rate, t.years), 0);

  // Bisection over a range wide enough for anything real: -99.99% to +1,000,000% a year. NPV
  // falls as the rate rises when the money goes in first, so a sign change brackets the root.
  let lo = -0.9999;
  let hi = 10_000;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 0.5 || hi - lo < 1e-9) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export type ValueReading = { date: Date; cents: number };

export type ReturnWindow = {
  startDate: Date;
  startCents: number;
  endDate: Date;
  endCents: number;
  /** Money in less money out over the window. */
  netContributedCents: number;
  /** End value less start value less net contributions. */
  growthCents: number;
  /** Money-weighted return a year; null when it cannot be worked out. */
  annualRate: number | null;
  /** The same over the window itself, not annualized; what a window under a year shows. */
  periodRate: number | null;
  days: number;
};

export type AccountHistory = {
  /** Value readings, any order. */
  values: readonly ValueReading[];
  /** Positive into the account, negative out. */
  flows: readonly CashFlow[];
};

function latestOnOrBefore(values: readonly ValueReading[], date: Date): ValueReading | null {
  let best: ValueReading | null = null;
  for (const v of values) if (v.date <= date && (!best || v.date > best.date)) best = v;
  return best;
}

function earliest(values: readonly ValueReading[]): ValueReading | null {
  let best: ValueReading | null = null;
  for (const v of values) if (!best || v.date < best.date) best = v;
  return best;
}

/**
 * The window from `from` (or the first reading, when there is none on or before it) to the
 * latest reading, over one or more accounts together. Null when no account has two readings to
 * span it.
 */
export function returnOver(accounts: readonly AccountHistory[], from: Date | null): ReturnWindow | null {
  const xirrFlows: CashFlow[] = [];
  let startCents = 0;
  let endCents = 0;
  let net = 0;
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  for (const account of accounts) {
    const end = latestOnOrBefore(account.values, new Date(8.64e15));
    if (!end) continue;
    const start = (from ? latestOnOrBefore(account.values, from) : null) ?? earliest(account.values);
    if (!start || start.date >= end.date) continue;
    startCents += start.cents;
    endCents += end.cents;
    xirrFlows.push({ date: start.date, cents: -start.cents }, { date: end.date, cents: end.cents });
    for (const f of account.flows) {
      if (f.date <= start.date || f.date > end.date) continue;
      net += f.cents;
      xirrFlows.push({ date: f.date, cents: -f.cents });
    }
    if (!startDate || start.date < startDate) startDate = start.date;
    if (!endDate || end.date > endDate) endDate = end.date;
  }
  if (!startDate || !endDate) return null;
  const days = Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS);
  const annualRate = xirr(xirrFlows);
  return {
    startDate,
    startCents,
    endDate,
    endCents,
    netContributedCents: net,
    growthCents: endCents - startCents - net,
    annualRate,
    periodRate: annualRate === null ? null : Math.pow(1 + annualRate, days / YEAR_DAYS) - 1,
    days,
  };
}

export type ReturnWindows = { thisYear: ReturnWindow | null; twelveMonths: ReturnWindow | null; sinceStart: ReturnWindow | null };

/** This calendar year, the last 12 months, and since the first reading. */
export function returnWindows(accounts: readonly AccountHistory[], todayYmd: string): ReturnWindows {
  const today = dateFromYmd(todayYmd);
  const yearStart = dateFromYmd(`${todayYmd.slice(0, 4)}-01-01`);
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  return {
    thisYear: returnOver(accounts, yearStart),
    twelveMonths: returnOver(accounts, yearAgo),
    sinceStart: returnOver(accounts, null),
  };
}

/** The rate to show for a window: annualized from a year up, the window's own below. */
export function displayRate(window: ReturnWindow): { rate: number; annualized: boolean } | null {
  if (window.days >= YEAR_DAYS) return window.annualRate === null ? null : { rate: window.annualRate, annualized: true };
  return window.periodRate === null ? null : { rate: window.periodRate, annualized: false };
}
