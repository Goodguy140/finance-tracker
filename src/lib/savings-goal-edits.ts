import type { PrismaClient } from "@prisma/client";
import { dateFromYmd } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { isLiabilityType } from "@/lib/net-worth";

/**
 * Adding, changing, deleting and paying into a savings goal, shared by Settings → Savings goals
 * (`src/app/actions/savings-goals.ts`) and the phone (`/api/v1/goals`), so a goal saves with the
 * same checks from both.
 */

export class SavingsGoalError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "SavingsGoalError";
  }
}

export type SavingsGoalInput = {
  name: string;
  targetCents: number;
  /** YYYY-MM-DD, or null for a goal with no date. */
  targetDate: string | null;
  /** The account whose balance the goal follows; null to track it by hand. */
  accountId: string | null;
  /** A hand-tracked goal's saved amount; left out, what is stored stays. */
  savedCents?: number;
};

type Db = PrismaClient;

export async function findOwnedGoal(db: Db, userId: string, goalId: string) {
  const goal = goalId ? await db.savingsGoal.findFirst({ where: { id: goalId, userId } }) : null;
  if (!goal) throw new SavingsGoalError("Goal not found.", true);
  return goal;
}

/** The goal's columns, with the linked account checked to be the user's own and to hold money. */
async function goalColumns(db: Db, userId: string, input: SavingsGoalInput) {
  let accountId: string | null = null;
  if (input.accountId) {
    const account = await db.account.findFirst({ where: { id: input.accountId, userId }, select: { id: true, type: true } });
    if (!account) throw new SavingsGoalError("Selected account was not found.");
    if (isLiabilityType(account.type)) throw new SavingsGoalError("Pick an account that holds the savings, not a card or loan.");
    accountId = account.id;
  }
  return {
    name: input.name,
    targetCents: input.targetCents,
    targetDate: input.targetDate ? dateFromYmd(input.targetDate) : null,
    accountId,
  };
}

/** Adds a goal. @throws SavingsGoalError */
export async function createSavingsGoal(db: Db, userId: string, input: SavingsGoalInput): Promise<string> {
  const columns = await goalColumns(db, userId, input);
  const created = await db.savingsGoal.create({ data: { userId, ...columns, savedCents: input.savedCents ?? 0 } });
  return created.id;
}

/** Replaces a goal's fields. Without `savedCents` (a linked goal's form) the hand-recorded amount stays. @throws SavingsGoalError */
export async function updateSavingsGoal(db: Db, userId: string, goalId: string, input: SavingsGoalInput): Promise<void> {
  const existing = await findOwnedGoal(db, userId, goalId);
  const columns = await goalColumns(db, userId, input);
  await db.savingsGoal.update({
    where: { id: existing.id },
    data: { ...columns, ...(input.savedCents === undefined ? {} : { savedCents: input.savedCents }) },
  });
}

/** Deletes a goal. The account it followed is untouched. @throws SavingsGoalError */
export async function deleteSavingsGoal(db: Db, userId: string, goalId: string): Promise<void> {
  const goal = await findOwnedGoal(db, userId, goalId);
  await db.savingsGoal.delete({ where: { id: goal.id } });
}

/**
 * Adds `deltaCents` to a hand-tracked goal's saved amount, clamped at zero. Each write is a
 * single conditional statement rather than read, add, write back, so two contributions
 * submitted together both count instead of one overwriting the other.
 */
async function applyContribution(db: Db, goalId: string, deltaCents: number) {
  const handTracked = { id: goalId, accountId: null };
  if (deltaCents >= 0) {
    const { count } = await db.savingsGoal.updateMany({
      where: { ...handTracked, savedCents: { lte: MAX_AMOUNT_CENTS - deltaCents } },
      data: { savedCents: { increment: deltaCents } },
    });
    if (count === 0) throw new SavingsGoalError("That would put the goal over the largest amount allowed.");
    return;
  }
  const taken = -deltaCents;
  // Either there is enough to take, or taking it empties the goal. A deposit landing
  // between the two statements can make both miss; going round again sees it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const decremented = await db.savingsGoal.updateMany({
      where: { ...handTracked, savedCents: { gte: taken } },
      data: { savedCents: { decrement: taken } },
    });
    if (decremented.count > 0) return;
    const emptied = await db.savingsGoal.updateMany({
      where: { ...handTracked, savedCents: { lt: taken } },
      data: { savedCents: 0 },
    });
    if (emptied.count > 0) return;
  }
  throw new SavingsGoalError("The goal changed while saving. Please try again.");
}

/** Adds to (positive) or takes from (negative) what a hand-tracked goal has saved. Never below zero. @throws SavingsGoalError */
export async function contributeToSavingsGoal(db: Db, userId: string, goalId: string, deltaCents: number): Promise<void> {
  const goal = await findOwnedGoal(db, userId, goalId);
  if (goal.accountId) throw new SavingsGoalError("This goal follows its account's balance; update the balance instead.");
  await applyContribution(db, goal.id, deltaCents);
}
