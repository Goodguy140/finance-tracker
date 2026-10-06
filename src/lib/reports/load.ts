import { TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
