"use server";

import { revalidatePath } from "next/cache";
import { CategoryKind, TransactionRuleTextOperator, TransactionType } from "@prisma/client";
import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";
import { HABIT_CATEGORY_NAMES } from "@/lib/insights/habit-patterns";
import { loadInsights } from "@/lib/insights/load";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { dismissInsightSchema, habitDetectionSchema, insightKeySchema, trackHabitSchema } from "@/lib/validation";
import { formAction, getFormValue } from "./_helpers";

/** How long "Snooze" hides an insight. */
const INSIGHT_SNOOZE_DAYS = 30;
/** Matches the cap in transaction-rules.ts; tracking a habit must not route around it. */
const MAX_TRANSACTION_RULES = 200;
/** Below this, a CONTAINS rule would fire inside unrelated words ("saq" in "Saquaro"). */
const MIN_CONTAINS_PATTERN_LENGTH = 5;

function revalidateInsights() {
  revalidatePath("/");
  revalidatePath("/insights");
}

export const dismissInsightAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { insightKey, mode } = dismissInsightSchema.parse({
    insightKey: getFormValue(formData, "insightKey"),
    mode: getFormValue(formData, "mode") || undefined,
  });
  const snoozedUntil = mode === "snooze" ? new Date(Date.now() + INSIGHT_SNOOZE_DAYS * 24 * 60 * 60 * 1000) : null;
  await prisma.insightDismissal.upsert({
    where: { userId_insightKey: { userId: user.id, insightKey } },
    create: { userId: user.id, insightKey, snoozedUntil },
    update: { snoozedUntil },
  });
  revalidateInsights();
});

export const restoreInsightAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { insightKey } = insightKeySchema.parse({ insightKey: getFormValue(formData, "insightKey") });
  await prisma.insightDismissal.deleteMany({ where: { userId: user.id, insightKey } });
  revalidateInsights();
});

export const setHabitDetectionAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { enabled } = habitDetectionSchema.parse({ enabled: getFormValue(formData, "enabled") });
  await prisma.insightPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, habitDetectionEnabled: enabled },
    update: { habitDetectionEnabled: enabled },
  });
  revalidateInsights();
});

/**
 * Files a habit's purchases under a category of their own, so it can carry a budget: finds or
 * creates the category, then adds one rule per merchant ahead of every existing rule — an
 * older "LCBO → Groceries" rule would otherwise keep winning. Past transactions are left
 * alone; "Apply to past…" on each rule is the reviewed way to move them.
 *
 * The merchants come from re-deriving the insight on the server, never from the form.
 */
export const trackHabitSeparatelyAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { habit } = trackHabitSchema.parse({ habit: getFormValue(formData, "habit") });
  const insights = await loadInsights(user.id, user.countryCode);
  if (!insights.habitsEnabled) throw new Error("Habit spending insights are turned off.");
  const insight = [...insights.visible, ...insights.dismissed].find((i) => i.key === `habit:${habit}`);
  if (insight?.action?.kind !== "track-habit") throw new Error("There is no recent spending to track for that.");
  const patterns = insight.action.merchants;

  const categoryName = HABIT_CATEGORY_NAMES[habit];
  const existingRules = await prisma.transactionRule.findMany({
    where: { userId: user.id },
    select: { titlePattern: true, setCategoryId: true },
  });

  await prisma.$transaction(async (tx) => {
    const category =
      (await tx.category.findFirst({ where: { userId: user.id, name: categoryName, kind: CategoryKind.EXPENSE } })) ??
      (await tx.category.create({ data: { userId: user.id, name: categoryName, kind: CategoryKind.EXPENSE } }));

    const already = new Set(
      existingRules
        .filter((r) => r.setCategoryId === category.id)
        .map((r) => normalizeExpenseTitleKey(r.titlePattern)),
    );
    const fresh = [...new Set(patterns.map((p) => p.trim()).filter(Boolean))].filter(
      (p) => !already.has(normalizeExpenseTitleKey(p)),
    );
    if (existingRules.length + fresh.length > MAX_TRANSACTION_RULES) {
      throw new Error(`You can have up to ${MAX_TRANSACTION_RULES} rules. Delete one you no longer need first.`);
    }
    if (fresh.length === 0) return;

    await tx.transactionRule.updateMany({ where: { userId: user.id }, data: { priority: { increment: fresh.length } } });
    await tx.transactionRule.createMany({
      data: fresh.map((pattern, priority) => ({
        userId: user.id,
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
  });
  revalidateInsights();
  revalidatePath("/settings");
});
