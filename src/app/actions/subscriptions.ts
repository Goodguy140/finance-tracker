"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import { toCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { isOccurrenceRace } from "@/lib/recurring-post";
import { skipRecurringOccurrence } from "@/lib/recurring-skip";
import { recomputeSubscriptionTransactionCredits } from "@/lib/subscription-credit";
import {
  deleteSubscriptionMemberSchema,
  setSubscriptionShareStatusSchema,
  skipRecurringOccurrenceSchema,
  subscriptionMemberSchema,
  updateSubscriptionMemberSchema,
} from "@/lib/validation";
import {
  getFormValue,
  formAction,
} from "./_helpers";

function revalidateSubscriptionViews() {
  revalidatePath("/");
  revalidatePath("/settings", "layout");
}

async function getOwnedRecurringRule(userId: string, recurringTransactionId: string) {
  const rule = await prisma.recurringTransaction.findFirst({
    where: { id: recurringTransactionId, userId },
    select: { id: true, name: true, type: true },
  });
  if (!rule) throw new Error("Subscription not found.");
  return rule;
}

export const createSubscriptionMemberAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = subscriptionMemberSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    name: getFormValue(formData, "name"),
    share: getFormValue(formData, "share"),
  });
  await getOwnedRecurringRule(user.id, payload.recurringTransactionId);

  await prisma.subscriptionMember.create({
    data: {
      userId: user.id,
      recurringTransactionId: payload.recurringTransactionId,
      name: payload.name,
      shareCents: toCents(payload.share),
    },
  });
  revalidateSubscriptionViews();
});

export const updateSubscriptionMemberAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = updateSubscriptionMemberSchema.parse({
    memberId: getFormValue(formData, "memberId"),
    name: getFormValue(formData, "name"),
    share: getFormValue(formData, "share"),
  });

  const member = await prisma.subscriptionMember.findFirst({
    where: { id: payload.memberId, userId: user.id },
    select: { id: true, recurringTransactionId: true },
  });
  if (!member) throw new Error("Subscription member not found.");

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionMember.update({
      where: { id: member.id },
      data: { name: payload.name, shareCents: toCents(payload.share) },
    });

    // Re-apply credits on any posted occurrence where this member is already marked paid.
    const paidStatuses = await tx.subscriptionShareStatus.findMany({
      where: { memberId: member.id, paid: true },
      select: { expectedDate: true },
    });
    for (const status of paidStatuses) {
      await recomputeSubscriptionTransactionCredits(tx, {
        userId: user.id,
        recurringTransactionId: member.recurringTransactionId,
        expectedDate: status.expectedDate,
      });
    }
  });
  revalidateSubscriptionViews();
});

export const deleteSubscriptionMemberAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = deleteSubscriptionMemberSchema.parse({
    memberId: getFormValue(formData, "memberId"),
  });

  const member = await prisma.subscriptionMember.findFirst({
    where: { id: payload.memberId, userId: user.id },
    select: { id: true, recurringTransactionId: true },
  });
  if (!member) throw new Error("Subscription member not found.");

  await prisma.$transaction(async (tx) => {
    // Capture occurrences this member contributed credits to before the cascade removes them.
    const paidStatuses = await tx.subscriptionShareStatus.findMany({
      where: { memberId: member.id, paid: true },
      select: { expectedDate: true },
    });
    await tx.subscriptionMember.delete({ where: { id: member.id } });
    for (const status of paidStatuses) {
      await recomputeSubscriptionTransactionCredits(tx, {
        userId: user.id,
        recurringTransactionId: member.recurringTransactionId,
        expectedDate: status.expectedDate,
      });
    }
  });
  revalidateSubscriptionViews();
});

export const setSubscriptionShareStatusAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = setSubscriptionShareStatusSchema.parse({
    memberId: getFormValue(formData, "memberId"),
    expectedDate: getFormValue(formData, "expectedDate"),
    field: getFormValue(formData, "field"),
    value: getFormValue(formData, "value"),
  });

  const member = await prisma.subscriptionMember.findFirst({
    where: { id: payload.memberId, userId: user.id },
    select: { id: true, recurringTransactionId: true },
  });
  if (!member) throw new Error("Subscription member not found.");

  const expectedDate = dateFromYmd(payload.expectedDate);
  const value = payload.value === "true";

  await prisma.$transaction(async (tx) => {
    const base = {
      userId: user.id,
      memberId: member.id,
      recurringTransactionId: member.recurringTransactionId,
      expectedDate,
      paidAt: payload.field === "paid" && value ? new Date() : null,
    };
    await tx.subscriptionShareStatus.upsert({
      where: { memberId_expectedDate: { memberId: member.id, expectedDate } },
      create: {
        ...base,
        billSent: payload.field === "billSent" ? value : false,
        paid: payload.field === "paid" ? value : false,
      },
      update:
        payload.field === "paid"
          ? { paid: value, paidAt: value ? new Date() : null }
          : { billSent: value },
    });

    if (payload.field === "paid") {
      // Recompute may throw if shares exceed the bill, rolling back the toggle.
      await recomputeSubscriptionTransactionCredits(tx, {
        userId: user.id,
        recurringTransactionId: member.recurringTransactionId,
        expectedDate,
      });
    }
  });
  revalidateSubscriptionViews();
});

export const skipRecurringOccurrenceAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = skipRecurringOccurrenceSchema.parse({
    recurringTransactionId: getFormValue(formData, "recurringTransactionId"),
    expectedDate: getFormValue(formData, "expectedDate"),
    reason: getFormValue(formData, "reason"),
    transactionId: getFormValue(formData, "transactionId") || undefined,
  });

  try {
    await prisma.$transaction((tx) =>
      skipRecurringOccurrence(tx, {
        userId: user.id,
        recurringTransactionId: payload.recurringTransactionId,
        expectedDate: dateFromYmd(payload.expectedDate),
        reason: payload.reason,
        transactionId: payload.transactionId,
      }),
    );
  } catch (error) {
    // Another posted occurrence already owns this expected date; the skip is satisfied.
    if (!isOccurrenceRace(error)) throw error;
  }

  revalidateSubscriptionViews();
});
