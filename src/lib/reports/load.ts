import { TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SavingsTransfers } from "@/lib/savings-transfers";
import type { ReportTx } from "./index";

/**
 * A user's expense and income rows from `since` on (all of them when null), shaped for the
 * report functions. Transfers are excluded here as well as in every total.
 *
 * Plaid's merchant name lives on the staged row, not the Transaction, so it is joined back on
 * the way the insights loader does it: a synced row groups under the bank's merchant name.
 */
export async function loadReportTxs(userId: string, since: Date | null): Promise<ReportTx[]> {
  const dateFilter = since ? { date: { gte: since } } : {};
  const [transactions, staged] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] }, ...dateFilter },
      select: {
        id: true,
        type: true,
        amountCents: true,
        date: true,
        title: true,
        note: true,
        categoryId: true,
        accountId: true,
        recurringTransactionId: true,
        category: { select: { name: true } },
        splitParts: { select: { categoryId: true, amountCents: true, category: { select: { name: true } } } },
        tags: { select: { tagId: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.plaidStagedTransaction.findMany({
      where: { userId, resolvedTransactionId: { not: null }, ...dateFilter },
      select: { resolvedTransactionId: true, merchantName: true },
    }),
  ]);

  const merchantByTx = new Map(staged.map((row) => [row.resolvedTransactionId as string, row.merchantName]));
  return transactions.map((t) => ({
    id: t.id,
    type: t.type,
    amountCents: t.amountCents,
    date: t.date,
    title: t.title,
    note: t.note,
    categoryId: t.categoryId,
    categoryName: t.category.name,
    accountId: t.accountId,
    recurringTransactionId: t.recurringTransactionId,
    splits: t.splitParts.map((p) => ({ categoryId: p.categoryId, categoryName: p.category.name, amountCents: p.amountCents })),
    merchantName: merchantByTx.get(t.id) ?? null,
    tagIds: t.tags.map((tag) => tag.tagId),
  }));
}

/** Years in which the user has any expense or income, for the period picker. */
export async function loadActivityBounds(userId: string): Promise<Date[]> {
  const where = { userId, type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] } };
  const [first, last] = await Promise.all([
    prisma.transaction.findFirst({ where, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.transaction.findFirst({ where, orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  if (!first || !last) return [];
  const out: Date[] = [];
  for (let y = first.date.getUTCFullYear(); y <= last.date.getUTCFullYear(); y++) out.push(new Date(Date.UTC(y, 0, 1)));
  return out;
}

/**
 * The accounts marked "Counts as savings" and the transfers from `since` on (all of them when
 * null) that could touch one, for `savingsCentsFor`. Nothing is loaded when no account is
 * marked: saved then stays income less spending.
 */
export async function loadSavingsTransfers(userId: string, since: Date | null): Promise<SavingsTransfers> {
  const accounts = await prisma.account.findMany({
    where: { userId, countsAsSavings: true },
    select: { id: true },
  });
  const savingsAccountIds = new Set(accounts.map((a) => a.id));
  if (savingsAccountIds.size === 0) return { savingsAccountIds, txs: [] };
  const ids = [...savingsAccountIds];
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      type: TransactionType.TRANSFER,
      OR: [{ accountId: { in: ids } }, { transferAccountId: { in: ids } }],
      ...(since ? { date: { gte: since } } : {}),
    },
    select: {
      date: true,
      amountCents: true,
      accountId: true,
      transferAccountId: true,
      transferPeerId: true,
      transferPeerOf: { select: { id: true } },
      tags: { select: { tagId: true } },
    },
    orderBy: { date: "asc" },
  });
  return {
    savingsAccountIds,
    txs: rows.map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      accountId: t.accountId,
      transferAccountId: t.transferAccountId,
      paired: t.transferPeerId !== null || t.transferPeerOf !== null,
      tagIds: t.tags.map((tag) => tag.tagId),
    })),
  };
}
