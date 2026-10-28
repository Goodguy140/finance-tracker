"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { TransactionType } from "@prisma/client";
import { describeActionError } from "@/lib/action-errors";
import type { ActionFailure } from "@/lib/action-result";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { createTransactionFromApi } from "@/lib/api-v1/transactions";
import { formatCurrency } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { parseQuickAdd } from "@/lib/search/quick-add";
import { requireUser } from "@/lib/session";
import { deleteTransactionWithUndo } from "@/lib/transaction-undo";

export type QuickAddResult = { ok: true; transactionId: string; message: string } | ActionFailure;

/**
 * Adds the expense typed into the master search ("12.50 tim hortons yesterday"). The text is
 * read again here rather than trusting the preview, and booked the way the API books an entry:
 * the user's rules and past titles fill what the text leaves out.
 */
export async function quickAddExpenseAction(text: string): Promise<QuickAddResult> {
  try {
    const user = await requireUser();
    const entry = parseQuickAdd(String(text ?? ""), currentYmdInTimeZone(user.timezone));
    if (!entry) return { ok: false, error: "Type an amount and what it was for, like “12.50 coffee”." };
    const result = await createTransactionFromApi(
      prisma,
      user,
      { type: "expense", amountCents: entry.amountCents, title: entry.title, date: entry.dateYmd },
      "search",
    );
    if (!result.ok) return { ok: false, error: result.error };
    scheduleBudgetAlertEmails(user.id);
    revalidatePath("/");
    const { transaction } = result;
    return {
      ok: true,
      transactionId: transaction.id,
      message: `Added ${formatCurrency(transaction.amountCents)} ${transaction.title ?? entry.title}.`,
    };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: describeActionError(err) };
  }
}

/** "Undo" right after a quick add: the expense goes, as a delete from the log would take it. */
export async function undoQuickAddAction(transactionId: string): Promise<{ ok: true } | ActionFailure> {
  try {
    const user = await requireUser();
    const undoId = await deleteTransactionWithUndo(prisma, user.id, String(transactionId ?? ""), TransactionType.EXPENSE);
    if (!undoId) return { ok: false, error: "That expense was already removed." };
    scheduleBudgetAlertEmails(user.id);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: describeActionError(err) };
  }
}
