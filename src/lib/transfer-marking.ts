import { CategoryKind, TransactionType, type Prisma } from "@prisma/client";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { convertAmountCents, untransferredType } from "@/lib/transfer-type";

/**
 * Turning a logged expense or income entry into a transfer, and back.
 *
 * The money is the same either way; only how it is counted changes. So the amount is
 * converted, never re-entered: an income of $500 is $500 arriving, which as a transfer is
 * -$500 (money in). Title, dates, account, note and any bank verification are untouched.
 *
 * The category cannot survive the trip — a transfer has only the user's transfer category,
 * and an expense category cannot hold income — so marking takes the transfer category and
 * unmarking takes the catch-all of the new kind ("Other" / "Other Income"), for the user to
 * change if it matters.
 */

type Tx = Prisma.TransactionClient;

export type TransferMarkRefusal = "not-found" | "split";

export type TransferMarkOutcome =
  | { ok: true; type: TransactionType }
  | { ok: false; reason: TransferMarkRefusal };

export async function markAsTransfer(
  tx: Tx,
  input: { userId: string; transactionId: string },
): Promise<TransferMarkOutcome> {
  const existing = await tx.transaction.findFirst({
    where: {
      id: input.transactionId,
      userId: input.userId,
      type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] },
    },
    select: { id: true, type: true, amountCents: true, _count: { select: { splitParts: true } } },
  });
  if (!existing) return { ok: false, reason: "not-found" };
  // A split spreads one charge over several budget categories; a transfer has no budget, so
  // there is nothing for the parts to mean.
  if (existing._count.splitParts > 0) return { ok: false, reason: "split" };

  const categoryId = await ensureFallbackCategoryFor(tx, input.userId, CategoryKind.TRANSFER);
  await tx.transaction.update({
    where: { id: existing.id },
    data: {
      type: TransactionType.TRANSFER,
      categoryId,
      amountCents: convertAmountCents(existing.type, existing.amountCents, TransactionType.TRANSFER),
    },
  });
  return { ok: true, type: TransactionType.TRANSFER };
}

export async function unmarkTransfer(
  tx: Tx,
  input: { userId: string; transactionId: string },
): Promise<TransferMarkOutcome> {
  const existing = await tx.transaction.findFirst({
    where: { id: input.transactionId, userId: input.userId, type: TransactionType.TRANSFER },
    select: { id: true, amountCents: true },
  });
  if (!existing) return { ok: false, reason: "not-found" };

  const type = untransferredType(existing.amountCents);
  const categoryId = await ensureFallbackCategoryFor(tx, input.userId, type);
  await tx.transaction.update({
    where: { id: existing.id },
    data: {
      type,
      categoryId,
      amountCents: convertAmountCents(TransactionType.TRANSFER, existing.amountCents, type),
    },
  });
  return { ok: true, type };
}
