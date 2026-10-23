import { TransactionType, type AccountType, type PrismaClient } from "@prisma/client";
import { dateFromYmd } from "@/lib/date-only";
import { isLiabilityType } from "@/lib/net-worth";
import { paidCentsOf } from "@/lib/owed-shares";

/**
 * Checking the log against a bank or card statement: from the statement's opening balance, do
 * the entries logged on the account over the statement's dates arrive at its closing balance?
 *
 * Money in and out of the account, from the account's side:
 * - an expense takes out what was actually paid (owed shares included, as the bank saw it);
 *   a refund (negative expense) puts money back;
 * - income puts money in;
 * - a transfer takes out its amount from the account it is booked on (a negative amount is the
 *   arriving leg), and an unpaired transfer that names this account as the other side puts the
 *   money in here. A paired transfer has its own leg on this account, so it is not counted twice.
 *
 * For a credit card or loan the balances are what is owed, so money out raises the balance.
 */

export type ReconcileTx = {
  id: string;
  type: TransactionType;
  amountCents: number;
  date: Date;
  title: string | null;
  categoryName: string;
  accountId: string | null;
  transferAccountId: string | null;
  transferPeerId: string | null;
  owedShares: ReadonlyArray<{ amountCents: number }>;
};

/** Money into the account from this entry (negative for money out), or null when it does not touch it. */
export function moneyIntoAccount(tx: ReconcileTx, accountId: string): number | null {
  if (tx.accountId === accountId) {
    if (tx.type === TransactionType.EXPENSE) return -paidCentsOf(tx);
    if (tx.type === TransactionType.INCOME) return tx.amountCents;
    if (tx.type === TransactionType.TRANSFER) return -tx.amountCents;
    return null;
  }
  if (tx.type === TransactionType.TRANSFER && tx.transferAccountId === accountId && !tx.transferPeerId) {
    return tx.amountCents;
  }
  return null;
}

export type ReconcileRow = { id: string; date: Date; title: string; inCents: number; balanceCents: number };

export type ReconcileResult = {
  rows: ReconcileRow[];
  moneyInCents: number;
  moneyOutCents: number;
  expectedClosingCents: number;
  /** Statement closing less what the log arrives at: zero when they agree. */
  differenceCents: number;
};

export function reconcile(input: {
  accountId: string;
  liability: boolean;
  openingCents: number;
  closingCents: number;
  transactions: readonly ReconcileTx[];
}): ReconcileResult {
  const sign = input.liability ? -1 : 1;
  let balance = input.openingCents;
  let moneyIn = 0;
  let moneyOut = 0;
  const rows: ReconcileRow[] = [];
  const sorted = [...input.transactions].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  for (const tx of sorted) {
    const into = moneyIntoAccount(tx, input.accountId);
    if (into === null) continue;
    if (into >= 0) moneyIn += into;
    else moneyOut += -into;
    balance += sign * into;
    rows.push({ id: tx.id, date: tx.date, title: tx.title?.trim() || tx.categoryName, inCents: into, balanceCents: balance });
  }
  return {
    rows,
    moneyInCents: moneyIn,
    moneyOutCents: moneyOut,
    expectedClosingCents: balance,
    differenceCents: input.closingCents - balance,
  };
}

export type ReconcileAccount = { id: string; name: string; type: AccountType; currency: string };

/** The account's entries over the statement's dates (both inclusive), and bank rows still waiting. */
export async function loadReconcileInputs(
  db: PrismaClient,
  userId: string,
  account: ReconcileAccount,
  startYmd: string,
  endYmd: string,
) {
  const start = dateFromYmd(startYmd);
  const endExclusive = dateFromYmd(endYmd);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const date = { gte: start, lt: endExclusive };
  const [transactions, waiting] = await Promise.all([
    db.transaction.findMany({
      where: { userId, date, OR: [{ accountId: account.id }, { transferAccountId: account.id }] },
      select: {
        id: true,
        type: true,
        amountCents: true,
        date: true,
        title: true,
        accountId: true,
        transferAccountId: true,
        transferPeerId: true,
        category: { select: { name: true } },
        owedShares: { select: { amountCents: true } },
      },
    }),
    db.plaidStagedTransaction.count({
      where: { userId, status: "NEEDS_REVIEW", suggestedAccountId: account.id, date },
    }),
  ]);
  return {
    liability: isLiabilityType(account.type),
    transactions: transactions.map(({ category, ...tx }) => ({ ...tx, categoryName: category.name })),
    waitingInQueue: waiting,
  };
}

/** "1,234.56", "-12", "$0" → cents; null when it is not an amount. Zero and negatives are fine. */
export function parseBalanceInput(raw: string | undefined | null): number | null {
  const s = (raw ?? "").trim().replace(/[$,\s]/g, "").replace(/−/g, "-");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
