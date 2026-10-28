"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind, Prisma, RecurringPostMode, TransactionType, type RecurringCadence } from "@prisma/client";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { ensureFallbackCategoryFor } from "@/lib/fallback-categories";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import { requireUser } from "@/lib/session";
import { postRecurringOccurrence } from "@/lib/recurring-post";
import { DEFAULT_SEMI_MONTHLY_DAYS, firstSemiMonthlyDateOnOrAfter, isValidSemiMonthlyDays } from "@/lib/recurring-transactions";
import { parseCancelFields } from "@/lib/subscription-cancel";
import {
  postRecurringTransactionSchema,
  recurringTransactionSchema,
  deleteRecurringTransactionSchema,
  setRecurringTransactionEnabledSchema,
  updateRecurringTransactionSchema,
} from "@/lib/validation";
import {
  getFormValue,
  assertUserOwnsActiveAccount,
  assertUserOwnsCategory,
  categoryKindForTransactionType,
  formAction,
} from "./_helpers";
/**
 * The category and other account a rule saves with, checked against the user. A bill or
 * income rule names its own category; a transfer goes to the Transfers category and names the
 * account the money goes to, which must be another of the user's active accounts.
 */
async function resolveRuleSides(
  userId: string,
  payload: { type: TransactionType; accountId: string; categoryId?: string; transferAccountId?: string },
): Promise<{ categoryId: string; transferAccountId: string | null }> {
  if (payload.type === TransactionType.TRANSFER) {
    if (!payload.transferAccountId) throw new Error("Choose the account the transfer goes to.");
    if (payload.transferAccountId === payload.accountId) throw new Error("Choose two different accounts.");
    await Promise.all([
      assertUserOwnsActiveAccount(userId, payload.accountId),
      assertUserOwnsActiveAccount(userId, payload.transferAccountId),
    ]);
    const categoryId = await ensureFallbackCategoryFor(prisma, userId, CategoryKind.TRANSFER);
    return { categoryId, transferAccountId: payload.transferAccountId };
  }
  if (!payload.categoryId) throw new Error("Choose a category.");
  await Promise.all([
    assertUserOwnsActiveAccount(userId, payload.accountId),
    assertUserOwnsCategory(userId, payload.categoryId, categoryKindForTransactionType(payload.type)),
  ]);
  return { categoryId: payload.categoryId, transferAccountId: null };
}

/**
 * Where a rule's dates land. A twice-a-month rule falls on its two days, and starts on the first
 * of them on or after the date entered. Any other rule falls on its next date's day of the month.
 */
function scheduleFor(payload: { cadence: RecurringCadence; firstDay?: number; secondDay?: number; beforeWeekend?: "on" }, entered: Date) {
  if (payload.cadence !== "SEMI_MONTHLY") {
    return { nextExpectedDate: entered, anchorDay: entered.getUTCDate(), secondAnchorDay: null, beforeWeekend: false };
  }
  const days = {
    day: payload.firstDay ?? DEFAULT_SEMI_MONTHLY_DAYS.day,
    secondDay: payload.secondDay ?? DEFAULT_SEMI_MONTHLY_DAYS.secondDay,
    beforeWeekend: payload.beforeWeekend === "on",
  };
  if (!isValidSemiMonthlyDays(days.day, days.secondDay)) {
    throw new Error("Choose two days at least a week apart, the second later in the month.");
  }
  return {
    nextExpectedDate: firstSemiMonthlyDateOnOrAfter(entered, days),
    anchorDay: days.day,
    secondAnchorDay: days.secondDay,
    beforeWeekend: days.beforeWeekend,
  };
}

/** Only bills carry a cancel link and decide-by date; income and transfers clear them. */
function cancelFieldsFor(type: TransactionType, formData: FormData) {
  if (type !== TransactionType.EXPENSE) return { cancelUrl: null, decideBy: null };
  // A form without the fields (an older one) leaves what is stored alone.
  if (!formData.has("cancelUrl") && !formData.has("decideBy")) return {};
  return parseCancelFields({ cancelUrl: getFormValue(formData, "cancelUrl"), decideBy: getFormValue(formData, "decideBy") });
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
  const type = payload.type as TransactionType;
  const sides = await resolveRuleSides(user.id, { ...payload, type });
  const schedule = scheduleFor(payload, dateFromYmd(payload.nextExpectedDate));
  const { nextExpectedDate } = schedule;
  const endDate = payload.endDate ? dateFromYmd(payload.endDate) : null;
  if (endDate && endDate.getTime() < nextExpectedDate.getTime()) {
    throw new Error("End date must be on or after the next expected date.");
  }

  const cancel = cancelFieldsFor(type, formData);
  await prisma.recurringTransaction.create({
    data: {
      ...cancel,
      userId: user.id,
      accountId: payload.accountId,
      categoryId: sides.categoryId,
      transferAccountId: sides.transferAccountId,
      type,
      name: payload.name,
      amountCents: toCents(payload.amount),
      ...schedule,
      cadence: payload.cadence,
      endDate,
      postMode: payload.postMode as RecurringPostMode,
      note: payload.note || null,
    },
  });
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
  const payload = parsed.data;
  const type = payload.type as TransactionType;
  const sides = await resolveRuleSides(user.id, { ...payload, type });
  const { anchorDay, ...schedule } = scheduleFor(payload, dateFromYmd(payload.nextExpectedDate));
  const { nextExpectedDate } = schedule;
  const endDate = payload.endDate ? dateFromYmd(payload.endDate) : null;
  if (endDate && endDate.getTime() < nextExpectedDate.getTime()) {
    throw new Error("End date must be on or after the next expected date.");
  }

  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: payload.recurringTransactionId, userId: user.id },
    select: { id: true, nextExpectedDate: true, cadence: true },
  });
  if (!existing) throw new Error("Recurring transaction not found.");

  const cancel = cancelFieldsFor(type, formData);
  await prisma.recurringTransaction.update({
    where: { id: existing.id },
    data: {
      ...cancel,
      ...schedule,
      // A new date sets the day the rule falls on. An unchanged one keeps the anchor, which
      // can be later than the date shown (a rule on the 31st waiting on Feb 28). A
      // twice-a-month rule's days are chosen in the form, so they are always saved, and its
      // first day is no anchor for a rule it is changed to.
      ...(payload.cadence !== "SEMI_MONTHLY" &&
      existing.cadence !== "SEMI_MONTHLY" &&
      existing.nextExpectedDate.getTime() === nextExpectedDate.getTime()
        ? {}
        : { anchorDay }),
      accountId: payload.accountId,
      categoryId: sides.categoryId,
      transferAccountId: sides.transferAccountId,
      type,
      name: payload.name.trim(),
      amountCents: toCents(payload.amount),
      cadence: payload.cadence,
      endDate,
      postMode: payload.postMode as RecurringPostMode,
      note: payload.note || null,
    },
  });
  revalidatePath("/");
});

export const setRecurringTransactionEnabledAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = setRecurringTransactionEnabledSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    enabled: getFormValue(formData, "enabled"),
  });

  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: payload.recurringTransactionId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Recurring transaction not found.");

  await prisma.recurringTransaction.update({
    where: { id: existing.id },
    // Turning a cancelled subscription back on means it was not cancelled after all.
    data: payload.enabled === "true" ? { enabled: true, cancelledAt: null } : { enabled: false },
  });
  revalidatePath("/");
});

export const deleteRecurringTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = deleteRecurringTransactionSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
  });

  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: payload.recurringTransactionId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Recurring transaction not found.");

  await prisma.recurringTransaction.delete({ where: { id: existing.id } });
  revalidatePath("/");
});

export const postRecurringTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = postRecurringTransactionSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    expectedDate: getFormValue(formData, "expectedDate"),
  });
  const expectedDate = dateFromYmd(payload.expectedDate);

  try {
    await prisma.$transaction((tx) =>
      postRecurringOccurrence(tx, { userId: user.id, recurringTransactionId: payload.recurringTransactionId, expectedDate }),
    );
  } catch (error) {
    // Two clicks racing on the same occurrence: the unique (rule, expected date) index
    // rejects the second insert, and there is nothing left to do.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }

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
  const updated = await prisma.recurringTransaction.updateMany({
    where: { id: recurringTransactionId, userId: user.id, type: TransactionType.EXPENSE },
    data: { enabled: false, cancelledAt: new Date() },
  });
  if (updated.count === 0) throw new Error("Recurring bill not found.");
  revalidatePath("/");
  revalidatePath("/insights");
});
