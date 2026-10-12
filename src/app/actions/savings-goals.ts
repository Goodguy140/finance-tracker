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

/** Adds to (or takes from) what a hand-tracked goal has saved. Never below zero. */
export const contributeToSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = savingsGoalContributionSchema.parse({
    goalId: getFormValue(formData, "goalId"),
    amount: getFormValue(formData, "amount"),
  });
  const goal = await findOwnedGoal(user.id, payload.goalId);
  if (goal.accountId) throw new Error("This goal follows its account's balance; update the balance instead.");
  const next = goal.savedCents + toCents(payload.amount);
  if (next > MAX_AMOUNT_CENTS) throw new Error("That would put the goal over the largest amount allowed.");
  await prisma.savingsGoal.update({ where: { id: goal.id }, data: { savedCents: Math.max(0, next) } });
  revalidateGoals();
});
