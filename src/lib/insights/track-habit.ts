import { CategoryKind, TransactionRuleTextOperator, TransactionType, type PrismaClient } from "@prisma/client";
import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";
import { HABIT_CATEGORY_NAMES } from "@/lib/insights/habit-patterns";
import type { loadInsights } from "@/lib/insights/load";
import type { HabitKind } from "@/lib/insights/types";
import { ruleTitlePatterns } from "@/lib/transaction-rules";

/**
 * "Track separately" on a habit insight, for the website and the phone: files a habit's purchases
 * under a category of their own, so it can carry a budget. Finds or creates the category, then
 * adds one rule per merchant ahead of every existing rule — an older "LCBO → Groceries" rule
 * would otherwise keep winning. Past transactions are left alone; applying each rule to past
 * entries is the reviewed way to move them.
 */

/** Matches the cap in transaction-rules.ts; tracking a habit must not route around it. */
const MAX_TRANSACTION_RULES = 200;
/** Below this, a CONTAINS rule would fire inside unrelated words ("saq" in "Saquaro"). */
const MIN_CONTAINS_PATTERN_LENGTH = 5;

type LoadedInsights = Awaited<ReturnType<typeof loadInsights>>;

/**
 * The merchants to file, re-derived from the insights on the server, never taken from a form;
 * or why there is nothing to track.
 */
export function habitMerchants(insights: LoadedInsights, habit: HabitKind): { ok: true; merchants: string[] } | { ok: false; error: string } {
  if (!insights.habitsEnabled) return { ok: false, error: "Habit spending insights are turned off." };
  const insight = [...insights.visible, ...insights.dismissed].find((i) => i.key === `habit:${habit}`);
  if (insight?.action?.kind !== "track-habit") return { ok: false, error: "There is no recent spending to track for that." };
  return { ok: true, merchants: insight.action.merchants };
}

export type TrackedHabit = { categoryId: string; categoryName: string; rulesAdded: number };

export async function fileHabitSeparately(
  db: PrismaClient,
  userId: string,
  habit: HabitKind,
  merchants: readonly string[],
): Promise<TrackedHabit> {
  const categoryName = HABIT_CATEGORY_NAMES[habit];
  const existingRules = await db.transactionRule.findMany({
    where: { userId },
    select: { titlePattern: true, setCategoryId: true },
  });

  return db.$transaction(async (tx) => {
    const category =
      (await tx.category.findFirst({ where: { userId, name: categoryName, kind: CategoryKind.EXPENSE } })) ??
      (await tx.category.create({ data: { userId, name: categoryName, kind: CategoryKind.EXPENSE } }));

    const already = new Set(
      existingRules
        .filter((r) => r.setCategoryId === category.id)
        .flatMap((r) => ruleTitlePatterns(r.titlePattern).map(normalizeExpenseTitleKey)),
    );
    const fresh = [...new Set(merchants.map((p) => p.trim()).filter(Boolean))].filter(
      (p) => !already.has(normalizeExpenseTitleKey(p)),
    );
    if (existingRules.length + fresh.length > MAX_TRANSACTION_RULES) {
      throw new Error(`You can have up to ${MAX_TRANSACTION_RULES} rules. Delete one you no longer need first.`);
    }
    if (fresh.length > 0) {
      await tx.transactionRule.updateMany({ where: { userId }, data: { priority: { increment: fresh.length } } });
      await tx.transactionRule.createMany({
        data: fresh.map((pattern, priority) => ({
          userId,
          priority,
          titleOperator:
            pattern.length < MIN_CONTAINS_PATTERN_LENGTH
              ? TransactionRuleTextOperator.STARTS_WITH
              : TransactionRuleTextOperator.CONTAINS,
          titlePattern: pattern,
          transactionType: TransactionType.EXPENSE,
          setCategoryId: category.id,
        })),
      });
    }
    return { categoryId: category.id, categoryName, rulesAdded: fresh.length };
  });
}
