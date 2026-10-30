import { PlaidStagedStatus } from "@prisma/client";
import { PAID_IN_FULL_WINDOW_DAYS } from "@/lib/financial-score";
import { prisma } from "@/lib/prisma";

/**
 * What was charged to each card in the {@link PAID_IN_FULL_WINDOW_DAYS} days up to its latest
 * balance, by account id: a balance no larger than that is being paid off each statement
 * (`paidInFull`). A synced balance already includes charges still waiting in the review queue,
 * so those count too; the ones the matcher paired with an entry are in the log already.
 */
export async function loadRecentCardCharges(
  userId: string,
  cards: ReadonlyArray<{ accountId: string; balanceDate: Date }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    cards.map(async ({ accountId, balanceDate }) => {
      const date = { gt: new Date(balanceDate.getTime() - PAID_IN_FULL_WINDOW_DAYS * 86_400_000), lte: balanceDate };
      const [logged, waiting] = await Promise.all([
        prisma.transaction.aggregate({
          where: { userId, accountId, type: "EXPENSE", date },
          _sum: { amountCents: true },
        }),
        prisma.plaidStagedTransaction.aggregate({
          where: {
            userId,
            status: PlaidStagedStatus.NEEDS_REVIEW,
            type: "EXPENSE",
            matchTransactionId: null,
            plaidAccount: { accountId },
            date,
          },
          _sum: { amountCents: true },
        }),
      ]);
      out.set(accountId, (logged._sum.amountCents ?? 0) + (waiting._sum.amountCents ?? 0));
    }),
  );
  return out;
}
