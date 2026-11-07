import { CategoryKind, TransactionType, type PrismaClient } from "@prisma/client";
import { LONG_TRANSACTION_OPTIONS } from "@/lib/prisma";
import { parseTagNames } from "@/lib/tags";
import { addTagsToTransaction, resolveTagIds } from "@/lib/tags-server";
import { deleteTransactionWithUndo } from "@/lib/transaction-undo";

/**
 * One change to several expenses at once: the Expense Log's Select mode on the website and the
 * phone's Select in Transactions. Rows that are not the user's expenses are ignored. A split
 * expense keeps its categories, which live on its lines, and is counted as skipped.
 */

export const BULK_EDIT_LIMIT = 500;
export const BULK_EDIT_OPS = ["category", "account", "tag", "reviewed", "delete"] as const;
export type BulkEditOp = (typeof BULK_EDIT_OPS)[number];

export type BulkEditOutcome = { changed: number; skipped: number; undoIds: string[] };

export class BulkEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkEditError";
  }
}

/** @throws BulkEditError with a message for the person */
export async function bulkEditExpenses(
  db: PrismaClient,
  userId: string,
  ids: readonly string[],
  op: string,
  rawValue: string,
): Promise<BulkEditOutcome> {
  if (ids.length > BULK_EDIT_LIMIT) throw new BulkEditError(`Pick at most ${BULK_EDIT_LIMIT} expenses at a time.`);
  const value = rawValue.trim();
  const rows = await db.transaction.findMany({
    where: { id: { in: [...ids] }, userId, type: TransactionType.EXPENSE },
    select: { id: true, _count: { select: { splitParts: true } } },
  });
  const rowIds = rows.map((row) => row.id);
  let changed = 0;
  let skipped = 0;
  const undoIds: string[] = [];

  if (op === "category") {
    if (!value) throw new BulkEditError("Choose a category.");
    const category = await db.category.findFirst({ where: { id: value, userId, kind: CategoryKind.EXPENSE }, select: { id: true } });
    if (!category) throw new BulkEditError("Selected category was not found.");
    const plain = rows.filter((row) => row._count.splitParts === 0).map((row) => row.id);
    skipped = rows.length - plain.length;
    changed = (await db.transaction.updateMany({ where: { id: { in: plain }, userId }, data: { categoryId: value } })).count;
  } else if (op === "account") {
    if (!value) throw new BulkEditError("Choose an account.");
    const account = await db.account.findFirst({ where: { id: value, userId }, select: { id: true } });
    if (!account) throw new BulkEditError("Selected account was not found.");
    changed = (await db.transaction.updateMany({ where: { id: { in: rowIds }, userId }, data: { accountId: value } })).count;
  } else if (op === "tag") {
    const names = parseTagNames([value]);
    if (names.length === 0) throw new BulkEditError("Type a tag to add.");
    await db.$transaction(async (tx) => {
      const tagIds = await resolveTagIds(tx, userId, names);
      for (const id of rowIds) await addTagsToTransaction(tx, id, tagIds);
    }, LONG_TRANSACTION_OPTIONS);
    changed = rowIds.length;
  } else if (op === "reviewed") {
    changed = (await db.transaction.updateMany({ where: { id: { in: rowIds }, userId }, data: { needsReview: false } })).count;
  } else if (op === "delete") {
    for (const id of rowIds) {
      const undoId = await deleteTransactionWithUndo(db, userId, id, TransactionType.EXPENSE);
      if (undoId) undoIds.push(undoId);
    }
    changed = undoIds.length;
  } else {
    throw new BulkEditError("Choose what to change.");
  }
  return { changed, skipped, undoIds };
}
