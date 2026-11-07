import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BULK_EDIT_LIMIT, BULK_EDIT_OPS, BulkEditError, bulkEditExpenses, type BulkEditOutcome } from "@/lib/bulk-edit-expenses";

/** The phone's Select in Transactions, written by the website's own `bulkEditExpenses`. */

const bodySchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1, "Pick at least one expense.").max(BULK_EDIT_LIMIT, `Pick at most ${BULK_EDIT_LIMIT} expenses at a time.`),
    op: z.enum(BULK_EDIT_OPS),
    /** The category or account id, or the tag's name; unused for `reviewed` and `delete`. */
    value: z.string().max(200).optional(),
  })
  .strict();

export type BulkEditApiResult = ({ ok: true } & BulkEditOutcome & { op: string; count: number }) | { ok: false; error: string };

export async function bulkEditFromApi(db: PrismaClient, userId: string, body: unknown): Promise<BulkEditApiResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { ids, op, value } = parsed.data;
  try {
    const outcome = await bulkEditExpenses(db, userId, [...new Set(ids)], op, value ?? "");
    return { ok: true, ...outcome, op, count: ids.length };
  } catch (err) {
    if (err instanceof BulkEditError) return { ok: false, error: err.message };
    throw err;
  }
}
