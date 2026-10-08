import type { Prisma, PrismaClient } from "@prisma/client";

export const BALANCE_SOURCE = { plaid: "PLAID", manual: "MANUAL" } as const;
export type BalanceSource = (typeof BALANCE_SOURCE)[keyof typeof BALANCE_SOURCE];

type Db = PrismaClient | Prisma.TransactionClient;

/** Stores an account's balance on `date`, replacing whatever that day already had. */
export async function upsertBalanceSnapshot(
  db: Db,
  row: { userId: string; accountId: string; date: Date; balanceCents: number; source: BalanceSource },
): Promise<void> {
  await db.accountBalanceSnapshot.upsert({
    where: { accountId_date: { accountId: row.accountId, date: row.date } },
    create: row,
    update: { balanceCents: row.balanceCents, source: row.source },
  });
}
