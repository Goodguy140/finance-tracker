import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Raised when a linked bank could not be revoked at Plaid.
 *
 * Deliberately blocks whatever it was raised from. Deleting a PlaidItem row without
 * calling Plaid's /item/remove does not end the connection: the item stays live at Plaid,
 * keeps billing, and keeps its standing access to the account — and once the local row is
 * gone there is no record of which item to revoke by hand. Refusing is recoverable; a
 * silently orphaned bank connection is not.
 */
export class PlaidRevocationError extends Error {
  readonly itemIds: string[];
  constructor(message: string, itemIds: string[]) {
    super(message);
    this.name = "PlaidRevocationError";
    this.itemIds = itemIds;
  }
}

/** Revokes one item at Plaid. Supplied by the Plaid client; injected so this stays testable. */
export type PlaidItemRevoker = (item: {
  id: string;
  itemId: string;
  accessTokenEnc: string;
}) => Promise<void>;

type ItemReader = Pick<PrismaClient, "plaidItem"> | Prisma.TransactionClient;

/**
 * Revokes every bank connection a user has, at Plaid, and returns the local row ids it
 * revoked. A caller that deletes afterwards in a separate transaction can check nothing
 * outside that list is about to go with them — a bank linked in between was never revoked.
 *
 * Call this *before* anything that cascades their rows away — account deletion, admin
 * deletion, or a financial-data reset. A user with no linked banks is the overwhelmingly
 * common case and costs one indexed count.
 *
 * With no revoker available the function refuses rather than proceeding, which is what
 * makes it safe to wire up before the Plaid client exists: today nothing can create a
 * PlaidItem, so it never fires; the moment linking ships it is already in the right place.
 */
export async function revokePlaidItemsForUser(
  db: ItemReader,
  userId: string,
  revoke?: PlaidItemRevoker | null,
): Promise<{ revoked: number; rowIds: string[] }> {
  const items = await db.plaidItem.findMany({
    where: { userId },
    select: { id: true, itemId: true, accessTokenEnc: true },
  });
  if (items.length === 0) return { revoked: 0, rowIds: [] };

  if (!revoke) {
    throw new PlaidRevocationError(
      `This account has ${items.length} linked bank connection(s) that cannot be revoked right now. Unlink them under Settings before continuing, so access at Plaid actually ends.`,
      items.map((item) => item.itemId),
    );
  }

  const failed: string[] = [];
  for (const item of items) {
    try {
      await revoke(item);
    } catch {
      failed.push(item.itemId);
    }
  }
  if (failed.length > 0) {
    throw new PlaidRevocationError(
      `Could not revoke ${failed.length} of ${items.length} linked bank connection(s) at Plaid. Nothing was deleted. Try again, or remove them from the Plaid dashboard first.`,
      failed,
    );
  }
  return { revoked: items.length, rowIds: items.map((item) => item.id) };
}
