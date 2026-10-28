import { moneyIntoAccount, type ReconcileTx } from "@/lib/reconciliation";

/**
 * One account's register: its entries newest first, each with the balance it left the account
 * at, worked back (and forward) from the latest balance reading.
 *
 * A reading on day D is taken to include every entry dated D. Entries on or before it walk the
 * balance back from the reading; entries after it walk it forward, and are marked, since no
 * reading has confirmed them yet. Without a reading there is no balance to work from, so only
 * the money in and out is shown.
 *
 * For a credit card or loan the balance is what is owed, so money out raises it.
 */

export type RegisterRow = {
  id: string;
  date: Date;
  title: string;
  type: ReconcileTx["type"];
  /** Money into the account (negative for money out), from the account's side. */
  inCents: number;
  /** The balance after this entry; null without a reading. */
  balanceCents: number | null;
  /** Dated after the latest reading: worked forward, not yet confirmed by one. */
  afterReading: boolean;
};

export function buildRegister(input: {
  accountId: string;
  liability: boolean;
  transactions: readonly ReconcileTx[];
  reading: { cents: number; date: Date } | null;
}): RegisterRow[] {
  const sign = input.liability ? -1 : 1;
  const rows: RegisterRow[] = [];
  for (const tx of input.transactions) {
    const into = moneyIntoAccount(tx, input.accountId);
    if (into === null) continue;
    rows.push({
      id: tx.id,
      date: tx.date,
      title: tx.title?.trim() || tx.categoryName,
      type: tx.type,
      inCents: into,
      balanceCents: null,
      afterReading: input.reading !== null && tx.date > input.reading.date,
    });
  }
  // Newest first; a stable order within a day.
  rows.sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id));
  if (!input.reading) return rows;

  let balance = input.reading.cents;
  for (const row of rows) {
    if (row.afterReading) continue;
    row.balanceCents = balance;
    balance -= sign * row.inCents;
  }
  balance = input.reading.cents;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row.afterReading) continue;
    balance += sign * row.inCents;
    row.balanceCents = balance;
  }
  return rows;
}

/** Money in and out over the rows dated from `start` (inclusive). */
export function moneyInOut(rows: readonly RegisterRow[], start: Date): { inCents: number; outCents: number } {
  let inCents = 0;
  let outCents = 0;
  for (const row of rows) {
    if (row.date < start) continue;
    if (row.inCents >= 0) inCents += row.inCents;
    else outCents -= row.inCents;
  }
  return { inCents, outCents };
}
