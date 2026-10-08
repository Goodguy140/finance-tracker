import { AccountType } from "@prisma/client";
import { ymOf } from "@/lib/insights/util";

/**
 * Transfers into the accounts a user marks "Counts as savings", as money saved.
 *
 * Every other total leaves transfers out: they only move money between the user's own
 * accounts. Moving money into a savings account is still the act of setting it aside, so once
 * any account is marked, "saved" means what reached those accounts by transfer, less what was
 * taken back out of them. It replaces income less spending rather than adding to it: the
 * money moved was part of that leftover already, and adding both would count it twice.
 *
 * A transfer can be in the log once (one bank's leg, the other side named in
 * `transferAccountId`) or twice (both legs, linked as peers). Each movement is counted once:
 *
 * - A leg booked on a savings account counts there: a negative amount arrived, a positive one
 *   left. That covers both a lone leg and the savings side of a pair.
 * - A leg booked elsewhere whose other side is a savings account counts only when it has no
 *   peer. With a peer, the savings account's own leg is already counted.
 * - A move between two savings accounts is not saving anything new, and is skipped.
 */

/** Account types that start out counted as savings; the user can change any of them. */
const SAVINGS_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  AccountType.SAVINGS,
  AccountType.TFSA,
  AccountType.RRSP,
  AccountType.FHSA,
  AccountType.NON_REGISTERED,
]);

export function defaultCountsAsSavings(type: AccountType | string): boolean {
  return SAVINGS_TYPES.has(type as AccountType);
}

export type SavingsTransferTx = {
  date: Date;
  /** Transfer sign: positive left `accountId`, negative arrived in it. */
  amountCents: number;
  accountId: string | null;
  transferAccountId: string | null;
  /** True when the other leg of this transfer is also in the log. */
  paired: boolean;
  tagIds?: string[];
};

/**
 * Cents this transfer moved into savings (negative when it moved money out of savings), or 0
 * when it does not touch a savings account or its other leg is the one that counts.
 */
export function savingsCentsFor(tx: SavingsTransferTx, savingsAccountIds: ReadonlySet<string>): number {
  const here = tx.accountId !== null && savingsAccountIds.has(tx.accountId);
  const there = tx.transferAccountId !== null && savingsAccountIds.has(tx.transferAccountId);
  if (here && there) return 0;
  if (here) return -tx.amountCents;
  if (there && !tx.paired) return tx.amountCents;
  return 0;
}

/** Net cents moved into savings across `txs`. */
export function totalSavedByTransfer(txs: readonly SavingsTransferTx[], savingsAccountIds: ReadonlySet<string>): number {
  return txs.reduce((sum, tx) => sum + savingsCentsFor(tx, savingsAccountIds), 0);
}

/** Net cents moved into savings in each of `months` (`YYYY-MM`), quiet months included. */
export function savedByTransferByMonth(
  txs: readonly SavingsTransferTx[],
  savingsAccountIds: ReadonlySet<string>,
  months: readonly string[],
): Map<string, number> {
  const out = new Map(months.map((ym) => [ym, 0]));
  for (const tx of txs) {
    const ym = ymOf(tx.date);
    if (!out.has(ym)) continue;
    out.set(ym, out.get(ym)! + savingsCentsFor(tx, savingsAccountIds));
  }
  return out;
}

/** The savings accounts and the transfers that might touch them, as Reports and the score load them. */
export type SavingsTransfers = {
  savingsAccountIds: ReadonlySet<string>;
  txs: SavingsTransferTx[];
};
