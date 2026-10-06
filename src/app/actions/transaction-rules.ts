"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { TransactionRuleTextOperator, TransactionType, type Prisma } from "@prisma/client";
import { describeActionError } from "@/lib/action-errors";
import type { ActionFailure } from "@/lib/action-result";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { planRuleApplication, type RuleChange, type RuleTransactionType } from "@/lib/transaction-rules";
import { toTransactionRuleInput } from "@/lib/transaction-rules-server";
import { normalizeTagName } from "@/lib/tags";
import { addTagsToTransaction, resolveTagIds } from "@/lib/tags-server";
import {
  learnedTitleSchema,
  moveTransactionRuleSchema,
  setTransactionRuleEnabledSchema,
  transactionRuleSchema,
  updateTransactionRuleSchema,
} from "@/lib/validation";
import {
  assertUserOwnsAccount,
  assertUserOwnsActiveAccount,
  formAction,
  getFormValue,
  LONG_TRANSACTION_OPTIONS,
} from "./_helpers";

const MAX_TRANSACTION_RULES = 200;
const PREVIEW_SAMPLE_SIZE = 50;

function optional(formData: FormData, key: string) {
  return getFormValue(formData, key).trim() || undefined;
}

/** Parses and ownership-checks the rule form into the columns both create and update write. */
async function readRuleForm(userId: string, formData: FormData) {
  const payload = transactionRuleSchema.parse({
    titleOperator: getFormValue(formData, "titleOperator") || "CONTAINS",
    titlePattern: getFormValue(formData, "titlePattern"),
    transactionType: optional(formData, "transactionType"),
    matchAccountId: optional(formData, "matchAccountId"),
    minAmount: optional(formData, "minAmount"),
    maxAmount: optional(formData, "maxAmount"),
    setCategoryId: optional(formData, "setCategoryId"),
    setTitle: optional(formData, "setTitle"),
    setAmount: optional(formData, "setAmount"),
    setAccountId: optional(formData, "setAccountId"),
    appendNote: optional(formData, "appendNote"),
    addTag: optional(formData, "addTag"),
  });

  let transactionType = (payload.transactionType as TransactionType | undefined) ?? null;
  if (payload.setCategoryId) {
    const category = await prisma.category.findFirst({
      where: { id: payload.setCategoryId, userId },
      select: { kind: true },
    });
    if (!category) throw new Error("Selected category was not found.");
    // Transfers have one category of their own and are left alone by rules.
    if (category.kind === "TRANSFER") throw new Error("Rules cannot set the transfer category.");
    // A category belongs to one side of the ledger, so the rule does too. Left on "any",
    // an expense category would silently do nothing for income and confuse the preview.
    const kind = category.kind as unknown as TransactionType;
    if (transactionType && transactionType !== kind) {
      throw new Error(
        `That category is for ${kind === TransactionType.EXPENSE ? "expenses" : "income"}; change the type or the category.`,
      );
    }
    transactionType = kind;
  }
  await Promise.all([
    payload.matchAccountId ? assertUserOwnsAccount(userId, payload.matchAccountId) : undefined,
    payload.setAccountId ? assertUserOwnsActiveAccount(userId, payload.setAccountId) : undefined,
  ]);
  const tagName = payload.addTag ? normalizeTagName(payload.addTag) : "";
  if (payload.addTag && !tagName) throw new Error("Enter a tag name for the rule to add.");
  const [addTagId] = tagName ? await resolveTagIds(prisma, userId, [tagName]) : [null];

  return {
    titleOperator: payload.titleOperator as TransactionRuleTextOperator,
    titlePattern: payload.titlePattern,
    transactionType,
    matchAccountId: payload.matchAccountId ?? null,
    minAmountCents: payload.minAmount !== undefined ? toCents(payload.minAmount) : null,
    maxAmountCents: payload.maxAmount !== undefined ? toCents(payload.maxAmount) : null,
    setCategoryId: payload.setCategoryId ?? null,
    setTitle: payload.setTitle || null,
    setAmountCents: payload.setAmount !== undefined ? toCents(payload.setAmount) : null,
    setAccountId: payload.setAccountId ?? null,
    appendNote: payload.appendNote || null,
    addTagId,
  } satisfies Omit<Prisma.TransactionRuleUncheckedCreateInput, "userId" | "priority">;
}

function revalidateRules() {
  revalidatePath("/");
  revalidatePath("/settings");
}

async function findOwnedRule(userId: string, ruleId: string) {
  const rule = await prisma.transactionRule.findFirst({ where: { id: ruleId, userId } });
  if (!rule) throw new Error("Rule not found.");
  return rule;
}

export const createTransactionRuleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const data = await readRuleForm(user.id, formData);
  const [count, last] = await Promise.all([
    prisma.transactionRule.count({ where: { userId: user.id } }),
    prisma.transactionRule.findFirst({
      where: { userId: user.id },
      orderBy: { priority: "desc" },
      select: { priority: true },
    }),
  ]);
  if (count >= MAX_TRANSACTION_RULES) {
    throw new Error(`You can have up to ${MAX_TRANSACTION_RULES} rules. Delete one you no longer need first.`);
  }
  await prisma.transactionRule.create({
    data: { ...data, userId: user.id, priority: (last?.priority ?? -1) + 1 },
  });
  revalidateRules();
});

export const updateTransactionRuleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { ruleId } = updateTransactionRuleSchema.parse({ ruleId: getFormValue(formData, "ruleId") });
  const rule = await findOwnedRule(user.id, ruleId);
  const data = await readRuleForm(user.id, formData);
  await prisma.transactionRule.update({ where: { id: rule.id }, data });
  revalidateRules();
});

export const deleteTransactionRuleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { ruleId } = updateTransactionRuleSchema.parse({ ruleId: getFormValue(formData, "ruleId") });
  const rule = await findOwnedRule(user.id, ruleId);
  await prisma.transactionRule.delete({ where: { id: rule.id } });
  revalidateRules();
});

export const setTransactionRuleEnabledAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = setTransactionRuleEnabledSchema.parse({
    ruleId: getFormValue(formData, "ruleId"),
    enabled: getFormValue(formData, "enabled"),
  });
  const rule = await findOwnedRule(user.id, payload.ruleId);
  await prisma.transactionRule.update({ where: { id: rule.id }, data: { enabled: payload.enabled === "true" } });
  revalidateRules();
});

/** Swaps a rule with its neighbour, then renumbers every rule 0..n-1 so gaps never build up. */
export const moveTransactionRuleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = moveTransactionRuleSchema.parse({
    ruleId: getFormValue(formData, "ruleId"),
    direction: getFormValue(formData, "direction"),
  });
  await prisma.$transaction(async (tx) => {
    const rules = await tx.transactionRule.findMany({
      where: { userId: user.id },
      orderBy: [{ priority: "asc" }, { id: "asc" }],
      select: { id: true, priority: true },
    });
    const index = rules.findIndex((r) => r.id === payload.ruleId);
    if (index === -1) throw new Error("Rule not found.");
    const target = payload.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rules.length) return;
    const ordered = [...rules];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    for (const [priority, rule] of ordered.entries()) {
      if (rule.priority !== priority) {
        await tx.transactionRule.update({ where: { id: rule.id }, data: { priority } });
      }
    }
  });
  revalidateRules();
});

export const hideLearnedTitleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { title } = learnedTitleSchema.parse({ title: getFormValue(formData, "title") });
  const titleKey = normalizeExpenseTitleKey(title);
  await prisma.hiddenTitleSuggestion.upsert({
    where: { userId_titleKey: { userId: user.id, titleKey } },
    create: { userId: user.id, titleKey },
    update: {},
  });
  revalidateRules();
});

export const unhideLearnedTitleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { title } = learnedTitleSchema.parse({ title: getFormValue(formData, "title") });
  await prisma.hiddenTitleSuggestion.deleteMany({
    where: { userId: user.id, titleKey: normalizeExpenseTitleKey(title) },
  });
  revalidateRules();
});

/** Plans one rule against every non-split transaction the user owns. */
async function planForRule(userId: string, ruleId: string) {
  const rule = toTransactionRuleInput(await findOwnedRule(userId, ruleId));
  const [rows, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        splitParts: { none: {} },
        // A rule is about expenses and income; transfers are left alone.
        type: rule.transactionType ?? { not: TransactionType.TRANSFER },
        ...(rule.matchAccountId ? { accountId: rule.matchAccountId } : {}),
      },
      select: {
        id: true,
        title: true,
        type: true,
        amountCents: true,
        accountId: true,
        categoryId: true,
        note: true,
        tags: { select: { tagId: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.category.findMany({ where: { userId }, select: { id: true, kind: true } }),
  ]);
  const kinds = new Map(categories.map((c) => [c.id, c.kind as RuleTransactionType]));
  return planRuleApplication(
    rule,
    rows.map(({ tags, ...row }) => ({ ...row, tagIds: tags.map((t) => t.tagId) })),
    kinds,
  );
}

export type RulePreviewResult = { ok: true; total: number; sample: RuleChange[] } | ActionFailure;

export async function previewTransactionRuleAction(ruleId: string): Promise<RulePreviewResult> {
  try {
    const user = await requireUser();
    const changes = await planForRule(user.id, ruleId);
    return { ok: true, total: changes.length, sample: changes.slice(0, PREVIEW_SAMPLE_SIZE) };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: describeActionError(err) };
  }
}

export type RuleApplyResult = { ok: true; updated: number } | ActionFailure;

/**
 * Rewrites past transactions the rule matches. Re-plans on the server rather than trusting
 * the preview the client saw, so a stale preview can never write values the rule no longer
 * produces. Title, category, account, note and tag only — never the amount.
 */
export async function applyTransactionRuleAction(ruleId: string): Promise<RuleApplyResult> {
  try {
    const user = await requireUser();
    const changes = await planForRule(user.id, ruleId);
    if (changes.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const change of changes) {
          await tx.transaction.update({
            where: { id: change.id },
            data: {
              title: change.after.title,
              categoryId: change.after.categoryId,
              accountId: change.after.accountId,
              note: change.after.note,
            },
          });
          if (change.addTagId) await addTagsToTransaction(tx, change.id, [change.addTagId]);
        }
      }, LONG_TRANSACTION_OPTIONS);
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.transaction_rule_applied,
        targetType: "TransactionRule",
        targetId: ruleId,
        metadata: { updated: changes.length },
        headers: await headers(),
      });
      scheduleBudgetAlertEmails(user.id);
      revalidateRules();
    }
    return { ok: true, updated: changes.length };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: describeActionError(err) };
  }
}
