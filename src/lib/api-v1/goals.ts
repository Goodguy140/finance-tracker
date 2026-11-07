import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import {
  contributeToSavingsGoal,
  createSavingsGoal,
  deleteSavingsGoal,
  SavingsGoalError,
  updateSavingsGoal,
  type SavingsGoalInput,
} from "@/lib/savings-goal-edits";
import { MAX_GOAL_NAME_LENGTH } from "@/lib/savings-goals";
import type { loadSavingsGoals } from "@/lib/savings-goals-data";

/** Savings goals on the phone: the Savings goals card's figures, and Settings → Savings goals' form in JSON. */

export function serializeGoals({ goals, accounts, todayYmd }: Awaited<ReturnType<typeof loadSavingsGoals>>) {
  return {
    today: todayYmd,
    /** Accounts a goal can follow: anything that holds money, not a card or a loan. */
    accounts,
    /** Soonest date first; goals with no date after them, oldest first. */
    goals: goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      targetCents: goal.targetCents,
      targetDate: goal.targetYmd,
      account: goal.account,
      currency: goal.currency,
      /** What a hand-tracked goal has had recorded against it. */
      manualSavedCents: goal.manualSavedCents,
      /** Saved so far: the linked balance, or the hand-recorded amount. Null with a linked account and no balance. */
      savedCents: goal.progress.savedCents,
      remainingCents: goal.progress.remainingCents,
      percent: Math.round(goal.progress.fraction * 100),
      status: goal.progress.status,
      monthsLeft: goal.progress.monthsLeft,
      monthlyNeededCents: goal.progress.monthlyNeededCents,
      monthlyPaceCents: goal.progress.monthlyPaceCents,
      monthlyTransferCents: goal.progress.monthlyTransferCents,
      projectedDate: goal.progress.projectedYmd,
      paceSource: goal.progress.paceSource,
    })),
  };
}

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.")
  .refine((value) => ymdFromDateUtc(dateFromYmd(value)) === value, "That date does not exist.");

const goalSchema = z
  .object({
    name: z.string().trim().min(1, "Name the goal.").max(MAX_GOAL_NAME_LENGTH),
    targetCents: z.number().int().min(1, "The target must be more than zero.").max(MAX_AMOUNT_CENTS),
    targetDate: ymd.nullable().optional(),
    accountId: z.string().min(1).nullable().optional(),
    /** A hand-tracked goal's saved amount; left out, what is stored stays. */
    savedCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).optional(),
  })
  .strict();

export type GoalResult = { ok: true; id: string } | { ok: false; status: 400 | 404; error: string };

function parseGoal(body: unknown): { ok: true; input: SavingsGoalInput } | { ok: false; status: 400; error: string } {
  const parsed = goalSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid goal." };
  const goal = parsed.data;
  return {
    ok: true,
    input: {
      name: goal.name,
      targetCents: goal.targetCents,
      targetDate: goal.targetDate ?? null,
      accountId: goal.accountId ?? null,
      // A goal that follows an account takes its saved amount from the balance.
      savedCents: goal.accountId ? undefined : goal.savedCents,
    },
  };
}

/** A SavingsGoalError as the response it stands for; anything else is a bug and is rethrown. */
function refusal(err: unknown): { ok: false; status: 400 | 404; error: string } {
  if (err instanceof SavingsGoalError) return { ok: false, status: err.notFound ? 404 : 400, error: err.message };
  throw err;
}

export async function createGoalFromApi(db: PrismaClient, userId: string, body: unknown): Promise<GoalResult> {
  const parsed = parseGoal(body);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true, id: await createSavingsGoal(db, userId, parsed.input) };
  } catch (err) {
    return refusal(err);
  }
}

export async function updateGoalFromApi(db: PrismaClient, userId: string, goalId: string, body: unknown): Promise<GoalResult> {
  const parsed = parseGoal(body);
  if (!parsed.ok) return parsed;
  try {
    await updateSavingsGoal(db, userId, goalId, parsed.input);
    return { ok: true, id: goalId };
  } catch (err) {
    return refusal(err);
  }
}

export async function deleteGoalFromApi(db: PrismaClient, userId: string, goalId: string): Promise<GoalResult> {
  try {
    await deleteSavingsGoal(db, userId, goalId);
    return { ok: true, id: goalId };
  } catch (err) {
    return refusal(err);
  }
}

const contributionSchema = z
  .object({
    /** Put toward the goal (positive) or taken back from it (negative). */
    amountCents: z
      .number()
      .int()
      .min(-MAX_AMOUNT_CENTS)
      .max(MAX_AMOUNT_CENTS)
      .refine((n) => n !== 0, "Enter an amount."),
  })
  .strict();

export async function contributeFromApi(db: PrismaClient, userId: string, goalId: string, body: unknown): Promise<GoalResult> {
  const parsed = contributionSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Enter an amount." };
  try {
    await contributeToSavingsGoal(db, userId, goalId, parsed.data.amountCents);
    return { ok: true, id: goalId };
  } catch (err) {
    return refusal(err);
  }
}
