import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * What people owe the user back on expenses (`OwedShare`), as the Expense Log's "Owed to you"
 * lists it and the phone's Owed to you screen does: every share still outstanding, whatever the
 * period on screen, and those paid back in the last 30 days, so a mistaken tap can be undone.
 */

export const OWED_PAID_RECENT_DAYS = 30;

type Db = PrismaClient | Prisma.TransactionClient;

export function owedToYouWhere(userId: string, now: Date): Prisma.OwedShareWhereInput {
  return {
    userId,
    OR: [{ paidAt: null }, { paidAt: { gte: new Date(now.getTime() - OWED_PAID_RECENT_DAYS * 24 * 60 * 60 * 1000) } }],
  };
}

/** Newest expense first. */
export const OWED_TO_YOU_ORDER = [{ transaction: { date: "desc" } }, { createdAt: "asc" }] satisfies Prisma.OwedShareOrderByWithRelationInput[];

/** Marks a share paid back, or not. False when the user has no such share. */
export async function setOwedSharePaid(db: Db, userId: string, shareId: string, paid: boolean, now = new Date()): Promise<boolean> {
  const updated = await db.owedShare.updateMany({ where: { id: shareId, userId }, data: { paidAt: paid ? now : null } });
  return updated.count > 0;
}
