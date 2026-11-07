"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  contributeToSavingsGoal,
  createSavingsGoal,
  deleteSavingsGoal,
  updateSavingsGoal,
  type SavingsGoalInput,
} from "@/lib/savings-goal-edits";
import { requireUser } from "@/lib/session";
import { savingsGoalContributionSchema, savingsGoalSchema } from "@/lib/validation";
import { formAction, getFormValue } from "./_helpers";

/** The goal's fields from its form; `src/lib/savings-goal-edits.ts` checks the linked account. */
function parseGoalForm(formData: FormData): SavingsGoalInput {
  const payload = savingsGoalSchema.parse({
    name: getFormValue(formData, "name"),
    target: getFormValue(formData, "target"),
    targetDate: getFormValue(formData, "targetDate"),
    accountId: getFormValue(formData, "accountId"),
    saved: getFormValue(formData, "saved"),
  });
  return {
    name: payload.name,
    targetCents: toCents(payload.target),
    targetDate: payload.targetDate || null,
    accountId: payload.accountId || null,
    savedCents: payload.saved === "" ? undefined : toCents(payload.saved),
  };
}

function goalId(formData: FormData): string {
  return z.string().min(1).parse(getFormValue(formData, "goalId"));
}

function revalidateGoals() {
  revalidatePath("/insights");
  revalidatePath("/settings", "layout");
}

export const createSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await createSavingsGoal(prisma, user.id, parseGoalForm(formData));
  revalidateGoals();
});

export const updateSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await updateSavingsGoal(prisma, user.id, goalId(formData), parseGoalForm(formData));
  revalidateGoals();
});

export const deleteSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await deleteSavingsGoal(prisma, user.id, goalId(formData));
  revalidateGoals();
});

/** Adds to (or takes from) what a hand-tracked goal has saved. Never below zero. */
export const contributeToSavingsGoalAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = savingsGoalContributionSchema.parse({
    goalId: getFormValue(formData, "goalId"),
    amount: getFormValue(formData, "amount"),
  });
  await contributeToSavingsGoal(prisma, user.id, payload.goalId, toCents(payload.amount));
  revalidateGoals();
});
