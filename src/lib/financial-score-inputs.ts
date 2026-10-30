import { endExclusiveOfMonthYm, shiftYm } from "@/lib/dashboard-period";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import type { RegisterRow } from "@/lib/account-register";
import type { BalanceReading } from "@/lib/net-worth";
import type { ProjectedBalances } from "@/lib/projected-balances";
import { moneyIntoAccount, type ReconcileTx } from "@/lib/reconciliation";

/**
 * Working out the financial score's balance-based inputs from what the loader reads: pure, so
 * each can be tested without a database. `financial-score-data.ts` calls them.
 */

const DAY_MS = 86_400_000;

/**
 * The lowest combined end-of-day balance of a set of accounts in each of `months`, from each
 * account's register (`buildRegister`, balances worked back from its latest reading). Before an
 * account's first entry its balance is the one that entry started from; an account with no
 * entries holds its reading throughout. Accounts without a reading are left out; null when none
 * has one.
 */
export function lowestBalanceByMonth(
  accounts: ReadonlyArray<{ rows: readonly RegisterRow[]; reading: { cents: number } | null }>,
  months: readonly string[],
): Map<string, number> | null {
  const read = accounts.filter((a) => a.reading !== null);
  if (read.length === 0 || months.length === 0) return null;
  const start = dateFromYmd(`${months[0]}-01`);
  const end = endExclusiveOfMonthYm(months[months.length - 1]);

  // Per account: its balance at the start, then each day's closing balance where it changed.
  const series = read.map(({ rows, reading }) => {
    // The register is newest first, entries within a day included: reversed, then sorted by day
    // (a stable sort), the last entry of each day is the one that closes it.
    const oldestFirst = [...rows]
      .reverse()
      .filter((r) => r.balanceCents !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const before = oldestFirst.filter((r) => r.date < start);
    const opening = before.length
      ? before[before.length - 1].balanceCents!
      : oldestFirst.length
        ? oldestFirst[0].balanceCents! - oldestFirst[0].inCents
        : reading!.cents;
    const closing = new Map<string, number>();
    for (const row of oldestFirst) {
      if (row.date >= start && row.date < end) closing.set(ymdFromDateUtc(row.date), row.balanceCents!);
    }
    return { opening, closing };
  });

  const out = new Map<string, number>();
  const balances = series.map((s) => s.opening);
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
    const ymd = ymdFromDateUtc(new Date(t));
    series.forEach((s, i) => {
      const c = s.closing.get(ymd);
      if (c !== undefined) balances[i] = c;
    });
    const total = balances.reduce((sum, n) => sum + n, 0);
    const ym = ymd.slice(0, 7);
    const low = out.get(ym);
    if (low === undefined || total < low) out.set(ym, total);
  }
  return out;
}

/**
 * Money paid into a card or loan per `YYYY-MM`: transfers arriving in it (one leg naming it, or
 * its own arriving leg) and income booked on it. Charges and refunds on the account are not
 * payments.
 */
export function paymentsIntoByMonth(txs: readonly ReconcileTx[], accountId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const tx of txs) {
    if (tx.type === "EXPENSE") continue;
    const into = moneyIntoAccount(tx, accountId);
    if (into === null || into <= 0) continue;
    const ym = ymdFromDateUtc(tx.date).slice(0, 7);
    out.set(ym, (out.get(ym) ?? 0) + into);
  }
  return out;
}

/** An account's last reading in each of `months` that has one, oldest first. */
export function monthEndReadings(readings: readonly BalanceReading[], months: readonly string[]): number[] {
  const byMonth = new Map<string, BalanceReading>();
  for (const r of readings) {
    const ym = ymdFromDateUtc(r.date).slice(0, 7);
    const prev = byMonth.get(ym);
    if (!prev || r.date > prev.date) byMonth.set(ym, r);
  }
  return months.flatMap((ym) => {
    const r = byMonth.get(ym);
    return r ? [r.cents] : [];
  });
}

/**
 * Net worth at the end of the first and last of `months`, and the account that lost most
 * between them. Needs a reading on or before the first month's end and another in the last two
 * months, at least three months apart, so a figure carried forward from one old reading never
 * reads as flat. Each account is valued at its latest reading on or before each point, and
 * only accounts with a value at both ends are counted.
 */
export function netWorthMovement(input: {
  accounts: ReadonlyArray<{ id: string; name: string; liability: boolean }>;
  readings: readonly BalanceReading[];
  months: readonly string[];
}): { startYm: string; startCents: number; endCents: number; biggestDrop: { name: string; cents: number } | null } | null {
  const { months } = input;
  if (months.length < 4) return null;
  const startYm = months[0];
  const lastYm = months[months.length - 1];
  const startEnd = endExclusiveOfMonthYm(startYm);
  const lastEnd = endExclusiveOfMonthYm(lastYm);
  const recentFrom = dateFromYmd(`${shiftYm(lastYm, -1)}-01`);

  const valueAt = (accountId: string, before: Date) => {
    let best: BalanceReading | null = null;
    for (const r of input.readings) {
      if (r.accountId !== accountId || r.date >= before) continue;
      if (!best || r.date > best.date) best = r;
    }
    return best;
  };
  let startCents = 0;
  let endCents = 0;
  let counted = false;
  let biggestDrop: { name: string; cents: number } | null = null;
  for (const account of input.accounts) {
    const from = valueAt(account.id, startEnd);
    const to = valueAt(account.id, lastEnd);
    if (!from || !to || to.date < recentFrom) continue;
    counted = true;
    const sign = account.liability ? -1 : 1;
    startCents += sign * from.cents;
    endCents += sign * to.cents;
    const drop = sign * (from.cents - to.cents);
    if (drop > 0 && (!biggestDrop || drop > biggestDrop.cents)) biggestDrop = { name: account.name, cents: drop };
  }
  return counted ? { startYm, startCents, endCents, biggestDrop } : null;
}

/**
 * The first asset account a projection takes below zero, read in the last `maxReadingAgeDays`;
 * null with no account read that recently (an older balance says little about now).
 */
export function firstBelowZero(
  projection: ProjectedBalances,
  todayYmd: string,
  maxReadingAgeDays: number,
  formatDate: (date: Date) => string,
): { belowZero: { accountName: string; days: number; dateLabel: string; cause: string | null } | null } | null {
  const today = dateFromYmd(todayYmd).getTime();
  const fresh = projection.accounts.filter((a) => !a.liability && (today - a.asOf.getTime()) / DAY_MS <= maxReadingAgeDays);
  if (fresh.length === 0) return null;
  const dips = fresh
    .filter((a) => a.belowZero)
    .sort((a, b) => a.belowZero!.date.getTime() - b.belowZero!.date.getTime());
  const first = dips[0];
  if (!first) return { belowZero: null };
  return {
    belowZero: {
      accountName: first.name,
      days: Math.max(0, Math.round((first.belowZero!.date.getTime() - today) / DAY_MS)),
      dateLabel: formatDate(first.belowZero!.date),
      cause: first.belowZero!.cause,
    },
  };
}
