import { TransactionType } from "@prisma/client";
import { inCurrencyWhere, sumOtherCurrencies, type OtherCurrencyTotal } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";
import type { SavingsTransfers } from "@/lib/savings-transfers";
import type { ReportTx } from "./index";

/**
 * A user's expense and income rows from `since` on (all of them when null), shaped for the
 * report functions. Transfers are excluded here as well as in every total, and so is anything on
 * an account in another currency than `homeCurrency`: there is no conversion to add it with.
 *
 * Plaid's merchant name lives on the staged row, not the Transaction, so it is joined back on
 * the way the insights loader does it: a synced row groups under the bank's merchant name.
 */
export async function loadReportTxs(userId: string, since: Date | null, homeCurrency: string): Promise<ReportTx[]> {
  const dateFilter = since ? { date: { gte: since } } : {};
  const [transactions, staged] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] },
        ...dateFilter,
        ...inCurrencyWhere(homeCurrency),
      },
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
 * marked: saved then stays income less spending. Only home-currency accounts count, and only
 * transfer rows booked on one: a row's amount is in its own account's currency.
 */
export async function loadSavingsTransfers(
  userId: string,
  since: Date | null,
  homeCurrency: string,
): Promise<SavingsTransfers> {
  const accounts = await prisma.account.findMany({
    where: { userId, countsAsSavings: true, currency: homeCurrency },
    select: { id: true },
  });
  const savingsAccountIds = new Set(accounts.map((a) => a.id));
  if (savingsAccountIds.size === 0) return { savingsAccountIds, txs: [] };
  const ids = [...savingsAccountIds];
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      type: TransactionType.TRANSFER,
      AND: [
        { OR: [{ accountId: { in: ids } }, { transferAccountId: { in: ids } }] },
        inCurrencyWhere(homeCurrency),
      ],
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

/**
 * Spending and income on accounts in other currencies than `homeCurrency` within
 * [`start`, `end`), summed per currency: what the home-currency totals leave out.
 */
export async function loadOtherCurrencyTotals(
  userId: string,
  homeCurrency: string,
  window: { start: Date | null; end: Date | null; tagId?: string | null },
): Promise<OtherCurrencyTotal[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] },
      account: { currency: { not: homeCurrency } },
      ...(window.start || window.end
        ? { date: { ...(window.start ? { gte: window.start } : {}), ...(window.end ? { lt: window.end } : {}) } }
        : {}),
      ...(window.tagId ? { tags: { some: { tagId: window.tagId } } } : {}),
    },
    select: { type: true, amountCents: true, account: { select: { currency: true } } },
  });
  return sumOtherCurrencies(rows.map((r) => ({ type: r.type, amountCents: r.amountCents, currency: r.account?.currency ?? null })));
}
