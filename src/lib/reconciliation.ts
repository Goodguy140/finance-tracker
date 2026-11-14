import { TransactionType, type AccountType, type PrismaClient } from "@prisma/client";
import { BALANCE_SOURCE } from "@/lib/account-balances";
import { shiftYm } from "@/lib/dashboard-period";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
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

export class ReconciliationError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "ReconciliationError";
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function dayAfter(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return ymdFromDateUtc(d);
}

/** "2026-02" → "2026-02-28". */
export function lastDayOfMonth(ym: string): string {
  const d = new Date(`${shiftYm(ym, 1)}-01T00:00:00Z`);
  d.setUTCDate(0);
  return ymdFromDateUtc(d);
}

/**
 * Where the next statement starts: the day after the last one reconciled, from its closing
 * balance; otherwise last month, with no opening balance. It runs to the end of its first month.
 */
export function nextStatement(
  last: { endDate: Date; closingCents: number } | undefined,
  todayYmd: string,
): { from: string; to: string; openingCents: number | null } {
  const from = last ? dayAfter(last.endDate) : `${shiftYm(todayYmd.slice(0, 7), -1)}-01`;
  return { from, to: lastDayOfMonth(from.slice(0, 7)), openingCents: last ? last.closingCents : null };
}

/**
 * Records that a statement agreed with the log, shared by the website's Mark reconciled and the
 * phone. Worked out again here rather than trusting the caller, and refused unless it balances
 * to the cent. The closing balance is also kept as the account's balance on the statement's last
 * day, unless the bank already reported one for it.
 * @throws ReconciliationError
 */
export async function saveReconciliation(
  db: PrismaClient,
  userId: string,
  input: { accountId: string; startYmd: string; endYmd: string; openingCents: number; closingCents: number },
): Promise<string> {
  const { accountId, startYmd, endYmd, openingCents, closingCents } = input;
  if (!YMD.test(startYmd) || !YMD.test(endYmd) || startYmd > endYmd) throw new ReconciliationError("Choose the statement's dates.");
  const account = await db.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true, name: true, type: true, currency: true },
  });
  if (!account) throw new ReconciliationError("Account not found.", true);
  const inputs = await loadReconcileInputs(db, userId, account, startYmd, endYmd);
  const result = reconcile({ accountId, liability: inputs.liability, openingCents, closingCents, transactions: inputs.transactions });
  if (result.differenceCents !== 0) throw new ReconciliationError("The log does not match this statement yet.");

  const endDate = dateFromYmd(endYmd);
  return db.$transaction(async (tx) => {
    const saved = await tx.accountReconciliation.create({
      data: { userId, accountId, startDate: dateFromYmd(startYmd), endDate, openingCents, closingCents },
      select: { id: true },
    });
    const existing = await tx.accountBalanceSnapshot.findUnique({
      where: { accountId_date: { accountId, date: endDate } },
      select: { source: true },
    });
    if (existing?.source !== BALANCE_SOURCE.plaid) {
      await tx.accountBalanceSnapshot.upsert({
        where: { accountId_date: { accountId, date: endDate } },
        create: { userId, accountId, date: endDate, balanceCents: closingCents, source: BALANCE_SOURCE.manual },
        update: { balanceCents: closingCents, source: BALANCE_SOURCE.manual },
      });
    }
    return saved.id;
  });
}

/** Forgets a reconciled statement; the balance it kept stays. @throws ReconciliationError */
export async function deleteReconciliation(db: PrismaClient, userId: string, reconciliationId: string): Promise<void> {
  const removed = await db.accountReconciliation.deleteMany({ where: { id: reconciliationId, userId } });
  if (removed.count === 0) throw new ReconciliationError("Reconciliation not found.", true);
}
