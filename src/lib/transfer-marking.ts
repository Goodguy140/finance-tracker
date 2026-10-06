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
 *
 * A transfer may also name the account on its other side, and may be one leg of a pair whose
 * other leg is also in the log. Unmarking either leg of a pair unmarks both: they were
 * confirmed as one movement of money, and half of it cannot be spending while the other half
 * is still a transfer. Unpairing keeps both as transfers and only forgets the link.
 */

type Tx = Prisma.TransactionClient;

export type TransferMarkRefusal = "not-found" | "split" | "owed" | "same-account";

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
    select: { id: true, type: true, amountCents: true, _count: { select: { splitParts: true, owedShares: true } } },
  });
  if (!existing) return { ok: false, reason: "not-found" };
  // A split spreads one charge over several budget categories; a transfer has no budget, so
  // there is nothing for the parts to mean.
  if (existing._count.splitParts > 0) return { ok: false, reason: "split" };
  // What others owe was taken out of the amount; a transfer moves the whole of it.
  if (existing._count.owedShares > 0) return { ok: false, reason: "owed" };

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
    select: { id: true, amountCents: true, transferPeerId: true },
  });
  if (!existing) return { ok: false, reason: "not-found" };

  const peer = existing.transferPeerId
    ? await tx.transaction.findFirst({
        where: { id: existing.transferPeerId, userId: input.userId, type: TransactionType.TRANSFER },
        select: { id: true, amountCents: true },
      })
    : null;

  const type = untransferredType(existing.amountCents);
  for (const leg of peer ? [existing, peer] : [existing]) {
    const legType = untransferredType(leg.amountCents);
    await tx.transaction.update({
      where: { id: leg.id },
      data: {
        type: legType,
        categoryId: await ensureFallbackCategoryFor(tx, input.userId, legType),
        amountCents: convertAmountCents(TransactionType.TRANSFER, leg.amountCents, legType),
        transferAccountId: null,
        transferPeerId: null,
      },
    });
  }
  return { ok: true, type };
}

/** Separates a paired transfer into two transfers that no longer point at each other. */
export async function unpairTransfer(
  tx: Tx,
  input: { userId: string; transactionId: string },
): Promise<TransferMarkOutcome> {
  const existing = await tx.transaction.findFirst({
    where: { id: input.transactionId, userId: input.userId, type: TransactionType.TRANSFER },
    select: { id: true, transferPeerId: true },
  });
  if (!existing?.transferPeerId) return { ok: false, reason: "not-found" };
  // Each leg named the other's account because the pair said so; without the pair that is
  // a guess, so it goes too, for the user to set again if it was right.
  await tx.transaction.updateMany({
    where: { userId: input.userId, id: { in: [existing.id, existing.transferPeerId] } },
    data: { transferPeerId: null, transferAccountId: null },
  });
  return { ok: true, type: TransactionType.TRANSFER };
}

/**
 * Names the account on the other side of an unpaired transfer, or clears it with null. A
 * paired leg takes its other side from the pair and is refused, as is the transfer's own
 * account.
 */
export async function setTransferAccount(
  tx: Tx,
  input: { userId: string; transactionId: string; transferAccountId: string | null },
): Promise<TransferMarkOutcome> {
  const existing = await tx.transaction.findFirst({
    where: {
      id: input.transactionId,
      userId: input.userId,
      type: TransactionType.TRANSFER,
      transferPeerId: null,
    },
    select: { id: true, accountId: true },
  });
  if (!existing) return { ok: false, reason: "not-found" };
  if (input.transferAccountId) {
    if (input.transferAccountId === existing.accountId) return { ok: false, reason: "same-account" };
    const account = await tx.account.findFirst({
      where: { id: input.transferAccountId, userId: input.userId },
      select: { id: true },
    });
    if (!account) return { ok: false, reason: "not-found" };
  }
  await tx.transaction.update({
    where: { id: existing.id },
    data: { transferAccountId: input.transferAccountId },
  });
  return { ok: true, type: TransactionType.TRANSFER };
}
