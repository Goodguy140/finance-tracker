"use server";

import { revalidatePath } from "next/cache";
import { Prisma, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { toCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import {
  advanceRecurringDate,
  isRecurringOccurrenceOnOrAfterNext,
  recurringAnchorDay,
} from "@/lib/recurring-transactions";
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

/** Days on either side of the expected date to search for a matching already-logged expense. */
const ALREADY_LOGGED_MATCH_WINDOW_DAYS = 15;

function revalidateSubscriptionViews() {
  revalidatePath("/");
  revalidatePath("/settings");
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
  const expectedDate = dateFromYmd(payload.expectedDate);

  try {
    await prisma.$transaction(async (tx) => {
      const rule = await tx.recurringTransaction.findFirst({
        where: { id: payload.recurringTransactionId, userId: user.id },
        select: {
          id: true,
          name: true,
          type: true,
          cadence: true,
          enabled: true,
          endDate: true,
          nextExpectedDate: true,
          anchorDay: true,
        },
      });
      if (!rule) throw new Error("Subscription not found.");

      // Optimistic concurrency: only advance if this is still the current occurrence, or a
      // later one on the rule's cadence (which passes over the missed ones before it).
      const anchorDay = recurringAnchorDay(rule);
      if (!isRecurringOccurrenceOnOrAfterNext(rule.nextExpectedDate, rule.cadence, expectedDate, anchorDay)) {
        throw new Error("This subscription has already moved to a different expected date.");
      }
      if (!rule.enabled) throw new Error("Subscription is disabled.");

      if (payload.reason === "already_logged") {
        await linkAlreadyLoggedTransaction(tx, {
          userId: user.id,
          rule,
          expectedDate,
          transactionId: payload.transactionId,
        });
      }

      const nextExpectedDate = advanceRecurringDate(expectedDate, rule.cadence, anchorDay);
      const stillEnabled = !rule.endDate || ymdFromDateUtc(nextExpectedDate) <= ymdFromDateUtc(rule.endDate);
      await tx.recurringTransaction.updateMany({
        where: { id: rule.id, userId: user.id, enabled: true, nextExpectedDate: rule.nextExpectedDate },
        data: { nextExpectedDate, anchorDay, enabled: stillEnabled },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Another posted occurrence already owns this expected date; treat the skip as satisfied.
      revalidateSubscriptionViews();
      return;
    }
    throw error;
  }

  revalidateSubscriptionViews();
});

type SkipTxClient = Prisma.TransactionClient;

async function linkAlreadyLoggedTransaction(
  tx: SkipTxClient,
  params: {
    userId: string;
    rule: { id: string; name: string; type: TransactionType };
    expectedDate: Date;
    transactionId?: string;
  },
) {
  // Match the rule's own kind: an income rule links an income entry, not an expense.
  const type = params.rule.type;
  const kindLabel = type === TransactionType.INCOME ? "income entry" : "expense";
  if (params.transactionId) {
    const txn = await tx.transaction.findFirst({
      where: {
        id: params.transactionId,
        userId: params.userId,
        type,
        recurringTransactionId: null,
      },
      select: { id: true },
    });
    if (!txn) throw new Error(`Selected ${kindLabel} was not found or is already linked to a recurring transaction.`);
    await tx.transaction.update({
      where: { id: txn.id },
      data: { recurringTransactionId: params.rule.id, recurringExpectedDate: params.expectedDate },
    });
    return;
  }

  // Auto-match an unlinked entry with the same title near the expected date (closest wins).
  const windowMs = ALREADY_LOGGED_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const candidates = await tx.transaction.findMany({
    where: {
      userId: params.userId,
      type,
      recurringTransactionId: null,
      title: params.rule.name,
      date: {
        gte: new Date(params.expectedDate.getTime() - windowMs),
        lte: new Date(params.expectedDate.getTime() + windowMs),
      },
    },
    select: { id: true, date: true },
  });
  if (candidates.length === 0) return; // Nothing to link; still advance the schedule.

  const best = candidates.reduce((closest, candidate) => {
    const closestDiff = Math.abs(closest.date.getTime() - params.expectedDate.getTime());
    const candidateDiff = Math.abs(candidate.date.getTime() - params.expectedDate.getTime());
    return candidateDiff < closestDiff ? candidate : closest;
  });
  await tx.transaction.update({
    where: { id: best.id },
    data: { recurringTransactionId: params.rule.id, recurringExpectedDate: params.expectedDate },
  });
}
