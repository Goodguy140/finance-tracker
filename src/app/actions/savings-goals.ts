"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dateFromYmd } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS, toCents } from "@/lib/money";
import { isLiabilityType } from "@/lib/net-worth";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { savingsGoalContributionSchema, savingsGoalSchema } from "@/lib/validation";
import { formAction, getFormValue } from "./_helpers";

async function findOwnedGoal(userId: string, goalId: string) {
  const goal = await prisma.savingsGoal.findFirst({ where: { id: z.string().min(1).parse(goalId), userId } });
  if (!goal) throw new Error("Goal not found.");
  return goal;
}

/** The goal's fields from its form, with the linked account checked to be the user's own. */
async function parseGoalForm(userId: string, formData: FormData) {
  const payload = savingsGoalSchema.parse({
    name: getFormValue(formData, "name"),
    target: getFormValue(formData, "target"),
    targetDate: getFormValue(formData, "targetDate"),
    accountId: getFormValue(formData, "accountId"),
    saved: getFormValue(formData, "saved"),
  });
  let accountId: string | null = null;
  if (payload.accountId) {
    const account = await prisma.account.findFirst({
      where: { id: payload.accountId, userId },
      select: { id: true, type: true },
    });
    if (!account) throw new Error("Selected account was not found.");
    if (isLiabilityType(account.type)) throw new Error("Pick an account that holds the savings, not a card or loan.");
    accountId = account.id;
  }
  return {
    name: payload.name,
    targetCents: toCents(payload.target),
    targetDate: payload.targetDate ? dateFromYmd(payload.targetDate) : null,
    accountId,
    savedCents: payload.saved === "" ? undefined : toCents(payload.saved),
  };
}

function revalidateGoals() {
  revalidatePath("/insights");
  revalidatePath("/settings", "layout");
}

export const createSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { savedCents, ...goal } = await parseGoalForm(user.id, formData);
  await prisma.savingsGoal.create({ data: { userId: user.id, ...goal, savedCents: savedCents ?? 0 } });
  revalidateGoals();
});

export const updateSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const existing = await findOwnedGoal(user.id, getFormValue(formData, "goalId"));
  const { savedCents, ...goal } = await parseGoalForm(user.id, formData);
  // A form without the field (a linked goal) leaves the hand-recorded amount as it was.
  await prisma.savingsGoal.update({
    where: { id: existing.id },
    data: { ...goal, ...(savedCents === undefined ? {} : { savedCents }) },
  });
  revalidateGoals();
});

export const deleteSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const goal = await findOwnedGoal(user.id, getFormValue(formData, "goalId"));
  await prisma.savingsGoal.delete({ where: { id: goal.id } });
  revalidateGoals();
});

/**
 * Adds `deltaCents` to a hand-tracked goal's saved amount, clamped at zero. Each write is a
 * single conditional statement rather than read, add, write back, so two contributions
 * submitted together both count instead of one overwriting the other.
 */
async function applyContribution(goalId: string, deltaCents: number) {
  const handTracked = { id: goalId, accountId: null };
  if (deltaCents >= 0) {
    const { count } = await prisma.savingsGoal.updateMany({
      where: { ...handTracked, savedCents: { lte: MAX_AMOUNT_CENTS - deltaCents } },
      data: { savedCents: { increment: deltaCents } },
    });
    if (count === 0) throw new Error("That would put the goal over the largest amount allowed.");
    return;
  }
  const taken = -deltaCents;
  // Either there is enough to take, or taking it empties the goal. A deposit landing
  // between the two statements can make both miss; going round again sees it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const decremented = await prisma.savingsGoal.updateMany({
      where: { ...handTracked, savedCents: { gte: taken } },
      data: { savedCents: { decrement: taken } },
    });
    if (decremented.count > 0) return;
    const emptied = await prisma.savingsGoal.updateMany({
      where: { ...handTracked, savedCents: { lt: taken } },
      data: { savedCents: 0 },
    });
    if (emptied.count > 0) return;
  }
  throw new Error("The goal changed while saving. Please try again.");
}

/** Adds to (or takes from) what a hand-tracked goal has saved. Never below zero. */
export const contributeToSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = savingsGoalContributionSchema.parse({
    goalId: getFormValue(formData, "goalId"),
    amount: getFormValue(formData, "amount"),
  });
  const goal = await findOwnedGoal(user.id, payload.goalId);
  if (goal.accountId) throw new Error("This goal follows its account's balance; update the balance instead.");
  await applyContribution(goal.id, toCents(payload.amount));
  revalidateGoals();
});
