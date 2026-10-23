import { Prisma, type PrismaClient, type TransactionType } from "@prisma/client";

/**
 * Undo for a deleted expense or income entry.
 *
 * Deleting takes the row and everything that hangs off it (split lines, owed shares, tags, the
 * bank verification, the contribution it was counted as, its transfer pair) and keeps them in
 * a DeletedTransaction row for UNDO_WINDOW_MS. Undo puts the row back with the same id, so the
 * Plaid review queue's references to it (stored as plain ids) line up again, and re-links
 * whatever is still free to be re-linked. Anything that has since been claimed by something
 * else (the bank record verified against another entry, the transfer re-paired) is left where
 * it is rather than taken back.
 */

export const UNDO_WINDOW_MS = 15 * 60 * 1000;

type Snapshot = {
  transaction: {
    id: string;
    accountId: string | null;
    categoryId: string;
    type: TransactionType;
    amountCents: number;
    preCreditCents: number | null;
    creditCents: number | null;
    creditBreakdownJson: string | null;
    title: string | null;
    date: string;
    postedDate: string | null;
    accountDescription: string | null;
    note: string | null;
    recurringTransactionId: string | null;
    recurringExpectedDate: string | null;
    transferAccountId: string | null;
    transferPeerId: string | null;
    createdAt: string;
  };
  splitParts: { id: string; categoryId: string; amountCents: number }[];
  owedShares: { id: string; name: string; amountCents: number; paidAt: string | null; createdAt: string }[];
  tagIds: string[];
  verification: {
    id: string;
    source: string;
    plaidTransactionId: string | null;
    plaidItemId: string | null;
    plaidAccountRowId: string | null;
    institutionName: string | null;
    verifiedAt: string;
    removedByPlaidAt: string | null;
    itemRemovedAt: string | null;
  } | null;
  investmentFlowId: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = (s: string | null) => (s ? new Date(s) : null);

/**
 * Deletes the user's transaction of `type` and keeps what is needed to put it back.
 * Returns the undo id, or null when there is no such transaction.
 */
export async function deleteTransactionWithUndo(
  db: PrismaClient,
  userId: string,
  transactionId: string,
  type: TransactionType,
  now = new Date(),
): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const row = await tx.transaction.findFirst({
      where: { id: transactionId, userId, type },
      include: { splitParts: true, owedShares: true, tags: true, verification: true, investmentFlow: true },
    });
    if (!row) return null;
    const snapshot: Snapshot = {
      transaction: {
        id: row.id,
        accountId: row.accountId,
        categoryId: row.categoryId,
        type: row.type,
        amountCents: row.amountCents,
        preCreditCents: row.preCreditCents,
        creditCents: row.creditCents,
        creditBreakdownJson: row.creditBreakdownJson,
        title: row.title,
        date: row.date.toISOString(),
        postedDate: iso(row.postedDate),
        accountDescription: row.accountDescription,
        note: row.note,
        recurringTransactionId: row.recurringTransactionId,
        recurringExpectedDate: iso(row.recurringExpectedDate),
        transferAccountId: row.transferAccountId,
        transferPeerId: row.transferPeerId,
        createdAt: row.createdAt.toISOString(),
      },
      splitParts: row.splitParts.map((p) => ({ id: p.id, categoryId: p.categoryId, amountCents: p.amountCents })),
      owedShares: row.owedShares.map((s) => ({
        id: s.id,
        name: s.name,
        amountCents: s.amountCents,
        paidAt: iso(s.paidAt),
        createdAt: s.createdAt.toISOString(),
      })),
      tagIds: row.tags.map((t) => t.tagId),
      verification: row.verification
        ? {
            id: row.verification.id,
            source: row.verification.source,
            plaidTransactionId: row.verification.plaidTransactionId,
            plaidItemId: row.verification.plaidItemId,
            plaidAccountRowId: row.verification.plaidAccountRowId,
            institutionName: row.verification.institutionName,
            verifiedAt: row.verification.verifiedAt.toISOString(),
            removedByPlaidAt: iso(row.verification.removedByPlaidAt),
            itemRemovedAt: iso(row.verification.itemRemovedAt),
          }
        : null,
      investmentFlowId: row.investmentFlow?.id ?? null,
    };
    await tx.deletedTransaction.deleteMany({
      where: { userId, deletedAt: { lt: new Date(now.getTime() - UNDO_WINDOW_MS) } },
    });
    const kept = await tx.deletedTransaction.create({
      data: { userId, transactionId: row.id, payloadJson: JSON.stringify(snapshot), deletedAt: now },
    });
    await tx.transaction.delete({ where: { id: row.id } });
    return kept.id;
  });
}

export type UndoRefusal = "expired" | "category-gone" | "conflict";

/** Puts a deleted transaction back. Returns the restored id, or why it could not. */
export async function undoDeletedTransaction(
  db: PrismaClient,
  userId: string,
  undoId: string,
  now = new Date(),
): Promise<{ ok: true; transactionId: string; type: TransactionType } | { ok: false; reason: UndoRefusal }> {
  const kept = await db.deletedTransaction.findFirst({ where: { id: undoId, userId } });
  if (!kept || now.getTime() - kept.deletedAt.getTime() > UNDO_WINDOW_MS) return { ok: false, reason: "expired" };
  const snap = JSON.parse(kept.payloadJson) as Snapshot;
  const t = snap.transaction;

  try {
    return await db.$transaction(async (tx) => {
      const category = await tx.category.findFirst({ where: { id: t.categoryId, userId } });
      if (!category) return { ok: false as const, reason: "category-gone" as const };
      const ownAccounts = new Set(
        (
          await tx.account.findMany({
            where: { userId, id: { in: [t.accountId, t.transferAccountId].filter((v): v is string => Boolean(v)) } },
            select: { id: true },
          })
        ).map((a) => a.id),
      );
      const recurringStillThere =
        t.recurringTransactionId != null &&
        (await tx.recurringTransaction.count({ where: { id: t.recurringTransactionId, userId } })) > 0;

      await tx.transaction.create({
        data: {
          id: t.id,
          userId,
          accountId: t.accountId && ownAccounts.has(t.accountId) ? t.accountId : null,
          categoryId: t.categoryId,
          type: t.type,
          amountCents: t.amountCents,
          preCreditCents: t.preCreditCents,
          creditCents: t.creditCents,
          creditBreakdownJson: t.creditBreakdownJson,
          title: t.title,
          date: new Date(t.date),
          postedDate: date(t.postedDate),
          accountDescription: t.accountDescription,
          note: t.note,
          recurringTransactionId: recurringStillThere ? t.recurringTransactionId : null,
          recurringExpectedDate: recurringStillThere ? date(t.recurringExpectedDate) : null,
          transferAccountId: t.transferAccountId && ownAccounts.has(t.transferAccountId) ? t.transferAccountId : null,
          createdAt: new Date(t.createdAt),
        },
      });

      const liveCategories = new Set(
        (
          await tx.category.findMany({
            where: { userId, id: { in: snap.splitParts.map((p) => p.categoryId) } },
            select: { id: true },
          })
        ).map((c) => c.id),
      );
      for (const part of snap.splitParts) {
        await tx.splitTransactionPart.create({
          data: {
            id: part.id,
            userId,
            transactionId: t.id,
            // A split line's category deleted since falls back to the entry's own.
            categoryId: liveCategories.has(part.categoryId) ? part.categoryId : t.categoryId,
            amountCents: part.amountCents,
          },
        });
      }
      for (const share of snap.owedShares) {
        await tx.owedShare.create({
          data: {
            id: share.id,
            userId,
            transactionId: t.id,
            name: share.name,
            amountCents: share.amountCents,
            paidAt: date(share.paidAt),
            createdAt: new Date(share.createdAt),
          },
        });
      }
      const liveTags = await tx.tag.findMany({ where: { userId, id: { in: snap.tagIds } }, select: { id: true } });
      for (const tag of liveTags) {
        await tx.transactionTag.create({ data: { transactionId: t.id, tagId: tag.id } });
      }

      const v = snap.verification;
      if (v) {
        // The bank record may have been matched to another entry since; it keeps that match.
        const claimed =
          v.plaidTransactionId != null &&
          (await tx.transactionVerification.count({ where: { userId, plaidTransactionId: v.plaidTransactionId } })) > 0;
        if (!claimed) {
          await tx.transactionVerification.create({
            data: {
              id: v.id,
              userId,
              transactionId: t.id,
              source: v.source as Prisma.TransactionVerificationCreateInput["source"],
              plaidTransactionId: v.plaidTransactionId,
              plaidItemId: v.plaidItemId,
              plaidAccountRowId: v.plaidAccountRowId,
              institutionName: v.institutionName,
              verifiedAt: new Date(v.verifiedAt),
              removedByPlaidAt: date(v.removedByPlaidAt),
              itemRemovedAt: date(v.itemRemovedAt),
            },
          });
        }
      }

      if (snap.investmentFlowId) {
        await tx.investmentFlow.updateMany({
          where: { id: snap.investmentFlowId, userId, transactionId: null },
          data: { transactionId: t.id },
        });
      }

      if (t.transferPeerId) {
        const peer = await tx.transaction.findFirst({
          where: { id: t.transferPeerId, userId, transferPeerId: null },
          select: { id: true },
        });
        if (peer) {
          await tx.transaction.update({ where: { id: t.id }, data: { transferPeerId: peer.id } });
          await tx.transaction.update({ where: { id: peer.id }, data: { transferPeerId: t.id } });
        }
      }

      await tx.deletedTransaction.delete({ where: { id: kept.id } });
      return { ok: true as const, transactionId: t.id, type: t.type };
    });
  } catch (err) {
    // The id came back already (a second Undo) or the recurring occurrence was posted again.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "conflict" };
    }
    throw err;
  }
}
