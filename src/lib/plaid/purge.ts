import { PlaidStagedStatus, type Prisma, type PrismaClient } from "@prisma/client";

/**
 * Deleting Plaid-sourced data once nothing needs it any more.
 *
 * What survives, and why: the user's own Transactions (they committed them; they are the
 * user's records, not Plaid's) and the *fact* that one was verified, with the institution
 * name for the badge. What does not survive is anything that only made sense while the
 * connection was live — the Plaid ids on those verifications, the review queue, the
 * account metadata, the credential.
 *
 * None of this revokes anything at Plaid. Every caller must have ended the connection there
 * first (`/item/remove`), or the item keeps billing with nothing left pointing at it.
 */

type Db = Pick<PrismaClient, "plaidItem" | "plaidAccount" | "plaidStagedTransaction" | "transactionVerification">
  | Prisma.TransactionClient;

/** Ids that point at Plaid records. Meaningless once the connection is gone. */
const SCRUBBED_PLAID_IDS = {
  plaidTransactionId: null,
  plaidItemId: null,
  plaidAccountRowId: null,
} satisfies Prisma.TransactionVerificationUpdateManyMutationInput;

/** Removes everything held for one bank connection. Call inside a transaction. */
export async function purgePlaidItemData(
  tx: Db,
  item: { id: string; userId: string },
  now: Date = new Date(),
): Promise<void> {
  await tx.transactionVerification.updateMany({
    where: { userId: item.userId, plaidItemId: item.id },
    data: { itemRemovedAt: now, ...SCRUBBED_PLAID_IDS },
  });
  await tx.plaidStagedTransaction.deleteMany({ where: { userId: item.userId, plaidItemId: item.id } });
  await tx.plaidAccount.deleteMany({ where: { userId: item.userId, plaidItemId: item.id } });
  await tx.plaidItem.delete({ where: { id: item.id } });
}

/**
 * Removes everything held for one account inside a connection that stays linked — used when
 * the user withdraws Plaid's access to that account alone. Returns whether it held anything.
 */
export async function purgePlaidAccountData(
  tx: Db,
  item: { id: string; userId: string },
  plaidAccountId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const account = await tx.plaidAccount.findFirst({
    where: { userId: item.userId, plaidItemId: item.id, plaidAccountId },
    select: { id: true },
  });
  if (!account) return false;
  await tx.transactionVerification.updateMany({
    where: { userId: item.userId, plaidAccountRowId: account.id },
    data: { itemRemovedAt: now, ...SCRUBBED_PLAID_IDS },
  });
  await tx.plaidStagedTransaction.deleteMany({ where: { userId: item.userId, plaidAccountRowId: account.id } });
  await tx.plaidAccount.delete({ where: { id: account.id } });
  return true;
}

/**
 * How long a staged row Plaid withdrew, or one a posted row replaced, is kept before it is
 * deleted. Long enough that a late `removed` for a superseded pending row, or a posted row
 * naming a withdrawn pending one, still finds it — both normally land within days. After
 * that the outcome without the row is the same as with it (see `planPage`), so keeping it
 * would only be keeping a stranger's merchant name and amount for no reason.
 */
export const SPENT_STAGED_ROW_RETENTION_DAYS = 30;

/**
 * Deletes staged rows nobody can act on any more: withdrawn by the bank before anyone
 * decided, or superseded by their posted successor. Unlike IGNORED, LINKED and ADDED, these
 * are not an idempotency key — Plaid never re-issues a withdrawn or superseded id.
 */
export async function pruneSpentStagedRows(
  db: Db,
  plaidItemId: string,
  now: Date = new Date(),
): Promise<number> {
  const before = new Date(now.getTime() - SPENT_STAGED_ROW_RETENTION_DAYS * 24 * 60 * 60_000);
  const { count } = await db.plaidStagedTransaction.deleteMany({
    where: {
      plaidItemId,
      status: { in: [PlaidStagedStatus.REMOVED_BY_PLAID, PlaidStagedStatus.SUPERSEDED] },
      updatedAt: { lt: before },
    },
  });
  return count;
}
