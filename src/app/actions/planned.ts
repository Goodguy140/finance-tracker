"use server";

import { revalidatePath } from "next/cache";
import { TransactionType } from "@prisma/client";
import { z } from "zod";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { dateFromYmd } from "@/lib/date-only";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { findOpenPlan, recordPlannedTransaction } from "@/lib/planned-transactions-record";
import { plannedTransactionSchema } from "@/lib/validation";
import { emitTransactionsCreated } from "@/lib/webhooks";
import { assertUserOwnsActiveAccount, assertUserOwnsCategory, formAction, getFormValue } from "./_helpers";

/** The plan's fields from its form, with the account and category checked to be the user's own. */
async function parsePlanForm(userId: string, formData: FormData) {
  const payload = plannedTransactionSchema.parse({
    type: getFormValue(formData, "type"),
    name: getFormValue(formData, "name"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    note: getFormValue(formData, "note") || undefined,
  });
  await Promise.all([
    assertUserOwnsActiveAccount(userId, payload.accountId),
    assertUserOwnsCategory(userId, payload.categoryId, payload.type),
  ]);
  return {
    type: payload.type,
    name: payload.name,
    amountCents: toCents(payload.amount),
    date: dateFromYmd(payload.date),
    accountId: payload.accountId,
    categoryId: payload.categoryId,
    note: payload.note ?? null,
  };
}

function revalidatePlans() {
  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath("/insights");
}

export const createPlannedTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const plan = await parsePlanForm(user.id, formData);
  await prisma.plannedTransaction.create({ data: { userId: user.id, ...plan } });
  revalidatePlans();
});

export const updatePlannedTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const existing = await findOpenPlan(prisma, user.id, z.string().min(1).parse(getFormValue(formData, "planId")));
  const plan = await parsePlanForm(user.id, formData);
  await prisma.plannedTransaction.update({ where: { id: existing.id }, data: plan });
  revalidatePlans();
});

/** "Didn't happen" or "Remove": the plan is dropped; nothing in the log changes. */
export const deletePlannedTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const result = await prisma.plannedTransaction.deleteMany({
    where: { id: z.string().min(1).parse(getFormValue(formData, "planId")), userId: user.id },
  });
  if (result.count === 0) throw new Error("Plan not found.");
  revalidatePlans();
});

/**
 * "Yes, add it": records the plan as an entry in the log, on the plan's date unless the form
 * gives another, and marks the plan done by linking it. The plan's link is claimed first, so a
 * double submit adds one entry, not two.
 */
export const recordPlannedTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const planId = z.string().min(1).parse(getFormValue(formData, "planId"));
  const { transactionId, type } = await recordPlannedTransaction(prisma, user.id, planId, getFormValue(formData, "date"));
  emitTransactionsCreated(user.id, [transactionId], "manual");
  if (type === TransactionType.EXPENSE) scheduleBudgetAlertEmails(user.id);
  revalidatePlans();
});
