"use server";

import { revalidatePath } from "next/cache";
import { Prisma, RecurringPostMode, TransactionType } from "@prisma/client";
import type { z } from "zod";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import { requireUser } from "@/lib/session";
import { postRecurringOccurrence } from "@/lib/recurring-post";
import {
  cancelSubscription,
  createRecurringRule,
  deleteRecurringRule,
  setRecurringRuleEnabled,
  updateRecurringRule,
  type RecurringRuleInput,
} from "@/lib/recurring-rules";
import { emitTransactionsCreated } from "@/lib/webhooks";
import {
  postRecurringTransactionSchema,
  recurringTransactionSchema,
  deleteRecurringTransactionSchema,
  setRecurringTransactionEnabledSchema,
  updateRecurringTransactionSchema,
} from "@/lib/validation";
import { getFormValue, formAction } from "./_helpers";

/** The cancel helper's fields, when the form has them; an older form leaves what is stored alone. */
function cancelInput(formData: FormData) {
  if (!formData.has("cancelUrl") && !formData.has("decideBy")) return undefined;
  return { cancelUrl: getFormValue(formData, "cancelUrl"), decideBy: getFormValue(formData, "decideBy") };
}

function ruleInput(payload: z.infer<typeof recurringTransactionSchema>, formData: FormData): RecurringRuleInput {
  return {
    type: payload.type as TransactionType,
    accountId: payload.accountId,
    categoryId: payload.categoryId,
    transferAccountId: payload.transferAccountId,
    name: payload.name,
    amountCents: toCents(payload.amount),
    cadence: payload.cadence,
    nextExpectedDate: payload.nextExpectedDate,
    firstDay: payload.firstDay,
    secondDay: payload.secondDay,
    beforeWeekend: payload.beforeWeekend === "on",
    endDate: payload.endDate || null,
    note: payload.note || null,
    postMode: payload.postMode as RecurringPostMode,
    cancel: cancelInput(formData),
  };
}

export const createRecurringTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = recurringTransactionSchema.parse({
    type: getFormValue(formData, "type"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId") || undefined,
    transferAccountId: getFormValue(formData, "transferAccountId") || undefined,
    name: getFormValue(formData, "name"),
    amount: getFormValue(formData, "amount"),
    cadence: getFormValue(formData, "cadence"),
    nextExpectedDate: getFormValue(formData, "nextExpectedDate"),
    firstDay: getFormValue(formData, "firstDay") || undefined,
    secondDay: getFormValue(formData, "secondDay") || undefined,
    beforeWeekend: getFormValue(formData, "beforeWeekend") || undefined,
    endDate: getFormValue(formData, "endDate") || undefined,
    note: getFormValue(formData, "note") || undefined,
    postMode: getFormValue(formData, "postMode") || undefined,
  });
  await createRecurringRule(prisma, user.id, ruleInput(payload, formData));
  revalidatePath("/");
});

export const updateRecurringTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const parsed = updateRecurringTransactionSchema.safeParse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    type: getFormValue(formData, "type"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId") || undefined,
    transferAccountId: getFormValue(formData, "transferAccountId") || undefined,
    name: getFormValue(formData, "name"),
    amount: getFormValue(formData, "amount"),
    cadence: getFormValue(formData, "cadence"),
    nextExpectedDate: getFormValue(formData, "nextExpectedDate"),
    firstDay: getFormValue(formData, "firstDay") || undefined,
    secondDay: getFormValue(formData, "secondDay") || undefined,
    beforeWeekend: getFormValue(formData, "beforeWeekend") || undefined,
    endDate: getFormValue(formData, "endDate") || undefined,
    note: getFormValue(formData, "note") || undefined,
    postMode: getFormValue(formData, "postMode") || undefined,
  });
  if (!parsed.success) {
    throw new Error("Recurring transaction name, amount, cadence, account, category, and next date are required.");
  }
  await updateRecurringRule(prisma, user.id, parsed.data.recurringTransactionId, ruleInput(parsed.data, formData));
  revalidatePath("/");
});

export const setRecurringTransactionEnabledAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = setRecurringTransactionEnabledSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    enabled: getFormValue(formData, "enabled"),
  });

  await setRecurringRuleEnabled(prisma, user.id, payload.recurringTransactionId, payload.enabled === "true");
  revalidatePath("/");
});

export const deleteRecurringTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = deleteRecurringTransactionSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
  });

  await deleteRecurringRule(prisma, user.id, payload.recurringTransactionId);
  revalidatePath("/");
});

export const postRecurringTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = postRecurringTransactionSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    expectedDate: getFormValue(formData, "expectedDate"),
  });
  const expectedDate = dateFromYmd(payload.expectedDate);

  let postedId: string | null = null;
  try {
    await prisma.$transaction((tx) =>
      postRecurringOccurrence(tx, {
        userId: user.id,
        recurringTransactionId: payload.recurringTransactionId,
        expectedDate,
        onPosted: (id) => {
          postedId = id;
        },
      }),
    );
  } catch (error) {
    // Two clicks racing on the same occurrence: the unique (rule, expected date) index
    // rejects the second insert, and there is nothing left to do.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }

  if (postedId) emitTransactionsCreated(user.id, [postedId], "manual");
  scheduleBudgetAlertEmails(user.id);
  revalidatePath("/");
});


/**
 * "Cancel subscription": the user has cancelled it with the provider. The rule is turned off
 * and the date kept, so Insights can show what it saves; turning it back on undoes both.
 */
export const cancelSubscriptionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { recurringTransactionId } = deleteRecurringTransactionSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
  });
  await cancelSubscription(prisma, user.id, recurringTransactionId);
  revalidatePath("/");
  revalidatePath("/insights");
});
