import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getTransactionForApi } from "@/lib/api-v1/transactions";
import { changeTransfer, TRANSFER_MARK_REFUSALS, type TransferChange } from "@/lib/transfer-marking";

/**
 * `POST /api/v1/transactions/:id/transfer`: the Expense Log's transfer controls for the phone.
 * `mark` books an expense or income entry as a transfer (the edit dialog's Mark as transfer),
 * `unmark` counts a transfer as spending or income again (both legs of a pair), and `unpair`
 * keeps both legs as transfers but forgets the link, so each one's accounts can be changed.
 */

const bodySchema = z.object({ change: z.enum(["mark", "unmark", "unpair"]) }).strict();

/** `{ "change": "mark" | "unmark" | "unpair" }`. */
export function parseTransferChangeBody(body: unknown): { ok: true; change: TransferChange } | { ok: false; error: string } {
  const parsed = bodySchema.safeParse(body);
  return parsed.success
    ? { ok: true, change: parsed.data.change }
    : { ok: false, error: 'Send { "change": "mark" }, { "change": "unmark" } or { "change": "unpair" }.' };
}

export type TransferChangeResult =
  | { ok: true; transaction: NonNullable<Awaited<ReturnType<typeof getTransactionForApi>>>; countsAgain: boolean }
  | { ok: false; status: 404 | 409; error: string };

/** Makes the change and answers the entry as it now is; `countsAgain` when it is spending or income again. */
export async function changeTransferFromApi(
  db: PrismaClient,
  userId: string,
  transactionId: string,
  change: TransferChange,
): Promise<TransferChangeResult> {
  const outcome = await db.$transaction((tx) => changeTransfer(tx, { userId, transactionId, change }));
  if (!outcome.ok) {
    if (outcome.reason === "not-found") {
      const error =
        change === "mark"
          ? "No expense or income entry with that id."
          : change === "unpair"
            ? "No paired transfer with that id."
            : "No transfer with that id.";
      return { ok: false, status: 404, error };
    }
    return { ok: false, status: 409, error: TRANSFER_MARK_REFUSALS[outcome.reason] };
  }
  const transaction = await getTransactionForApi(db, userId, transactionId);
  if (!transaction) return { ok: false, status: 404, error: "No transaction with that id." };
  return { ok: true, transaction, countsAgain: change === "unmark" };
}
