"use server";

import { revalidatePath } from "next/cache";
import { Prisma, RecurringPostMode, TransactionType } from "@prisma/client";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import { requireUser } from "@/lib/session";
import { postRecurringOccurrence } from "@/lib/recurring-post";
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
export const createRecurringTransactionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = recurringTransactionSchema.parse({
    type: getFormValue(formData, "type"),
    accountId: getFormValue(formData, "accountId"),
    categoryId: getFormValue(formData, "categoryId"),
    name: getFormValue(formData, "name"),
    amount: getFormValue(formData, "amount"),
    cadence: getFormValue(formData, "cadence"),
    nextExpectedDate: getFormValue(formData, "nextExpectedDate"),
    endDate: getFormValue(formData, "endDate") || undefined,
    note: getFormValue(formData, "note") || undefined,
    postMode: getFormValue(formData, "postMode") || undefined,
  });
  const type = payload.type as TransactionType;
  await Promise.all([
    assertUserOwnsActiveAccount(user.id, payload.accountId),
    assertUserOwnsCategory(user.id, payload.categoryId, categoryKindForTransactionType(type)),
  ]);
  const nextExpectedDate = dateFromYmd(payload.nextExpectedDate);
  const endDate = payload.endDate ? dateFromYmd(payload.endDate) : null;
  if (endDate && endDate.getTime() < nextExpectedDate.getTime()) {
    throw new Error("End date must be on or after the next expected date.");
  }

  await prisma.recurringTransaction.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type,
      name: payload.name,
      amountCents: toCents(payload.amount),
      cadence: payload.cadence,
      nextExpectedDate,
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
    categoryId: getFormValue(formData, "categoryId"),
    name: getFormValue(formData, "name"),
    amount: getFormValue(formData, "amount"),
    cadence: getFormValue(formData, "cadence"),
    nextExpectedDate: getFormValue(formData, "nextExpectedDate"),
    endDate: getFormValue(formData, "endDate") || undefined,
    note: getFormValue(formData, "note") || undefined,
    postMode: getFormValue(formData, "postMode") || undefined,
  });
  if (!parsed.success) {
    throw new Error("Recurring transaction name, amount, cadence, account, category, and next date are required.");
  }
  const payload = parsed.data;
  const type = payload.type as TransactionType;
  await Promise.all([
    assertUserOwnsActiveAccount(user.id, payload.accountId),
    assertUserOwnsCategory(user.id, payload.categoryId, categoryKindForTransactionType(type)),
  ]);
  const nextExpectedDate = dateFromYmd(payload.nextExpectedDate);
  const endDate = payload.endDate ? dateFromYmd(payload.endDate) : null;
  if (endDate && endDate.getTime() < nextExpectedDate.getTime()) {
    throw new Error("End date must be on or after the next expected date.");
  }

  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: payload.recurringTransactionId, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Recurring transaction not found.");

  await prisma.recurringTransaction.update({
    where: { id: existing.id },
    data: {
      accountId: payload.accountId,
      categoryId: payload.categoryId,
      type,
      name: payload.name.trim(),
      amountCents: toCents(payload.amount),
      cadence: payload.cadence,
      nextExpectedDate,
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
    data: { enabled: payload.enabled === "true" },
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

