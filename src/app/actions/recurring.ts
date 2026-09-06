"use server";

import { revalidatePath } from "next/cache";
import { Prisma, TransactionType } from "@prisma/client";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { requireUser } from "@/lib/session";
import { advanceRecurringDate } from "@/lib/recurring-transactions";
import { recomputeSubscriptionTransactionCredits } from "@/lib/subscription-credit";
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
    await prisma.$transaction(async (tx) => {
      const rule = await tx.recurringTransaction.findFirst({
        where: { id: payload.recurringTransactionId, userId: user.id },
        include: { account: true, category: true },
      });
      if (!rule) throw new Error("Recurring transaction not found.");

      if (ymdFromDateUtc(rule.nextExpectedDate) !== payload.expectedDate) {
        const posted = await tx.transaction.findFirst({
          where: {
            userId: user.id,
            recurringTransactionId: rule.id,
            recurringExpectedDate: expectedDate,
          },
          select: { id: true },
        });
        if (posted) return;
        throw new Error("This recurring transaction has already moved to a different expected date.");
      }
      if (!rule.enabled) throw new Error("Recurring transaction is disabled.");
      if (rule.account.archived) throw new Error("Cannot post a recurring transaction to an archived account.");
      if (rule.category.kind !== categoryKindForTransactionType(rule.type)) {
        throw new Error("Recurring transaction category does not match its income/expense type.");
      }
      if (rule.endDate && ymdFromDateUtc(expectedDate) > ymdFromDateUtc(rule.endDate)) {
        throw new Error("Recurring transaction has passed its end date.");
      }

      const nextExpectedDate = advanceRecurringDate(rule.nextExpectedDate, rule.cadence);
      const stillEnabled = !rule.endDate || ymdFromDateUtc(nextExpectedDate) <= ymdFromDateUtc(rule.endDate);
      const updated = await tx.recurringTransaction.updateMany({
        where: {
          id: rule.id,
          userId: user.id,
          enabled: true,
          nextExpectedDate: rule.nextExpectedDate,
        },
        data: {
          nextExpectedDate,
          enabled: stillEnabled,
        },
      });
      if (updated.count === 0) return;

      await tx.transaction.create({
        data: {
          userId: user.id,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          type: rule.type,
          amountCents: rule.amountCents,
          title: rule.name,
          date: expectedDate,
          note: rule.note,
          recurringTransactionId: rule.id,
          recurringExpectedDate: expectedDate,
        },
      });

      // Apply credits for any shared-subscription members already marked paid for this occurrence.
      await recomputeSubscriptionTransactionCredits(tx, {
        userId: user.id,
        recurringTransactionId: rule.id,
        expectedDate,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }

  revalidatePath("/");
});

