"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteReconciliation, parseBalanceInput, saveReconciliation } from "@/lib/reconciliation";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

/**
 * Records that a statement agreed with the log, through `saveReconciliation` (shared with the
 * iPhone app): worked out again rather than trusting the page, refused unless it balances to the
 * cent, and the closing balance kept as the account's balance on the statement's last day.
 */
export const saveReconciliationAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const openingCents = parseBalanceInput(getFormValue(formData, "opening"));
  const closingCents = parseBalanceInput(getFormValue(formData, "closing"));
  if (openingCents === null || closingCents === null) throw new Error("Enter both balances from the statement.");
  await saveReconciliation(prisma, user.id, {
    accountId: getFormValue(formData, "accountId"),
    startYmd: getFormValue(formData, "from"),
    endYmd: getFormValue(formData, "to"),
    openingCents,
    closingCents,
  });
  revalidatePath("/settings", "layout");
  revalidatePath("/reports");
});

export const deleteReconciliationAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await deleteReconciliation(prisma, user.id, getFormValue(formData, "reconciliationId"));
  revalidatePath("/settings", "layout");
});
