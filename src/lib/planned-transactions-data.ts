import { Prisma, TransactionType, type PrismaClient } from "@prisma/client";
import { ymdFromDateUtc } from "@/lib/date-only";
import { prisma } from "@/lib/prisma";
import { matchPlannedTransactions, planMatchWindow } from "@/lib/planned-transactions";

/**
 * Links each open plan to the entry that turned out to be it (`matchPlannedTransactions`).
 * Run before plans are read, so an entry typed, imported or committed from the bank queue
 * settles its plan whichever way it arrived. Idempotent: a plan already linked, or an entry
 * another request linked first, is left as it is.
 */
export async function settlePlannedTransactions(userId: string, client: PrismaClient = prisma): Promise<number> {
  const open = await client.plannedTransaction.findMany({
    where: { userId, transactionId: null },
    select: { id: true, type: true, accountId: true, categoryId: true, amountCents: true, date: true, createdAt: true },
  });
  const plans = open.map((p) => ({
    ...p,
    type: p.type === TransactionType.INCOME ? ("INCOME" as const) : ("EXPENSE" as const),
    dateYmd: ymdFromDateUtc(p.date),
  }));
  const window = planMatchWindow(plans);
  if (!window) return 0;
  const entries = await client.transaction.findMany({
    where: {
      userId,
      type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] },
      accountId: { in: [...new Set(plans.map((p) => p.accountId))] },
      date: window,
      // A recurring rule's posting is that rule's, not a one-off's.
      recurringTransactionId: null,
      plannedFrom: { is: null },
      createdAt: { gte: plans.reduce((min, p) => (p.createdAt < min ? p.createdAt : min), plans[0].createdAt) },
    },
    select: { id: true, type: true, accountId: true, categoryId: true, amountCents: true, date: true, createdAt: true },
  });
  const matches = matchPlannedTransactions(
    plans,
    entries.map((e) => ({ ...e, dateYmd: ymdFromDateUtc(e.date) })),
  );
  let settled = 0;
  for (const [planId, transactionId] of matches) {
    try {
      const { count } = await client.plannedTransaction.updateMany({
        where: { id: planId, userId, transactionId: null },
        data: { transactionId },
      });
      settled += count;
    } catch (err) {
      // Another request linked this entry to a plan first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return settled;
}

/**
 * The user's open plans (not yet matched to an entry), earliest first, after settling any the
 * log now has. With `currency`, only plans on accounts in it, as the forecasts total one currency.
 */
export async function loadOpenPlannedTransactions(
  userId: string,
  options: { currency?: string } = {},
  client: PrismaClient = prisma,
) {
  await settlePlannedTransactions(userId, client);
  const plans = await client.plannedTransaction.findMany({
    where: {
      userId,
      transactionId: null,
      account: { archived: false, ...(options.currency ? { currency: options.currency } : {}) },
    },
    include: {
      account: { select: { id: true, name: true, currency: true } },
      category: { select: { id: true, name: true } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return plans.map((p) => ({ ...p, type: p.type === TransactionType.INCOME ? ("INCOME" as const) : ("EXPENSE" as const) }));
}

export type OpenPlannedTransaction = Awaited<ReturnType<typeof loadOpenPlannedTransactions>>[number];
