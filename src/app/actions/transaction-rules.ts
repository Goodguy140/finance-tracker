"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { describeActionError } from "@/lib/action-errors";
import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";
import type { ActionFailure } from "@/lib/action-result";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { scheduleBudgetAlertEmails } from "@/lib/budget-alert-dispatch";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  applyTransactionRule,
  createTransactionRule,
  findOwnedRule as findRule,
  hideLearnedTitle,
  planRuleChanges,
  prepareTransactionRule,
  splitRows,
} from "@/lib/transaction-rule-edits";
import type { RuleChange } from "@/lib/transaction-rules";
import {
  learnedTitleSchema,
  moveTransactionRuleSchema,
  setTransactionRuleEnabledSchema,
  transactionRuleSchema,
  updateTransactionRuleSchema,
} from "@/lib/validation";
import { formAction, getFormValue } from "./_helpers";

const PREVIEW_SAMPLE_SIZE = 50;

function optional(formData: FormData, key: string) {
  return getFormValue(formData, key).trim() || undefined;
}

/** The editor's split lines: parallel category and percent fields, a wholly blank line skipped. */
function readSplitLines(formData: FormData) {
  const categoryIds = formData.getAll("ruleSplitCategoryId").map((v) => String(v ?? "").trim());
  const percents = formData.getAll("ruleSplitPercent").map((v) => String(v ?? "").trim());
  if (categoryIds.length !== percents.length) throw new Error("The split lines could not be read. Try again.");
  return categoryIds
    .map((categoryId, i) => ({ categoryId, basisPoints: percents[i] }))
    .filter((line) => line.categoryId !== "" || line.basisPoints !== "");
}

/** Parses the rule form; `prepareTransactionRule` checks it against the user. */
function parseRuleForm(formData: FormData) {
  return transactionRuleSchema.parse({
    titleOperator: getFormValue(formData, "titleOperator") || "CONTAINS",
    titlePatterns: formData.getAll("titlePattern").map(String),
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
    markAsTransfer: getFormValue(formData, "markAsTransfer") === "on" || undefined,
    setTransferAccountId: optional(formData, "setTransferAccountId"),
    split: readSplitLines(formData),
  });
}

function revalidateRules() {
  revalidatePath("/");
  revalidatePath("/settings", "layout");
}

function findOwnedRule(userId: string, ruleId: string) {
  return findRule(prisma, userId, ruleId);
}

export const createTransactionRuleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await createTransactionRule(prisma, user.id, parseRuleForm(formData));
  revalidateRules();
});

export const updateTransactionRuleAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const { ruleId } = updateTransactionRuleSchema.parse({ ruleId: getFormValue(formData, "ruleId") });
  const rule = await findOwnedRule(user.id, ruleId);
  const { rule: data, split } = await prepareTransactionRule(prisma, user.id, parseRuleForm(formData));
  await prisma.transactionRule.update({
    where: { id: rule.id },
    data: { ...data, splits: { deleteMany: {}, create: splitRows(split) } },
  });
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
  await hideLearnedTitle(prisma, user.id, title);
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

export type RulePreviewResult = { ok: true; total: number; sample: RuleChange[] } | ActionFailure;

export async function previewTransactionRuleAction(ruleId: string): Promise<RulePreviewResult> {
  try {
    const user = await requireUser();
    const changes = await planRuleChanges(prisma, user.id, ruleId);
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
 * produces. Title, category, account, note, tag, split and transfer only — never the amount
 * (a transfer converts it to the transfer sign, the same money counted differently).
 */
export async function applyTransactionRuleAction(ruleId: string): Promise<RuleApplyResult> {
  try {
    const user = await requireUser();
    const updated = await applyTransactionRule(prisma, user.id, ruleId);
    if (updated > 0) {
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.transaction_rule_applied,
        targetType: "TransactionRule",
        targetId: ruleId,
        metadata: { updated },
        headers: await headers(),
      });
      scheduleBudgetAlertEmails(user.id);
      revalidateRules();
    }
    return { ok: true, updated };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: describeActionError(err) };
  }
}
