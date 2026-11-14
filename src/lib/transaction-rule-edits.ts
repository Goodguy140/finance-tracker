import { TransactionRuleTextOperator, TransactionType, type Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { normalizeExpenseTitleKey } from "@/lib/expense-title-suggestions";
import { toCents } from "@/lib/money";
import { LONG_TRANSACTION_OPTIONS } from "@/lib/prisma";
import { saveSplitLines } from "@/lib/split-lines";
import { normalizeTagName } from "@/lib/tags";
import { addTagsToTransaction, resolveTagIds } from "@/lib/tags-server";
import { planRuleApplication, type RuleChange, type RuleTransactionType } from "@/lib/transaction-rules";
import { RULE_SPLITS_INCLUDE, toTransactionRuleInput } from "@/lib/transaction-rules-server";
import { markAsTransfer } from "@/lib/transfer-marking";
import type { transactionRuleSchema } from "@/lib/validation";

/**
 * Adding, changing, turning off, reordering and deleting a rule, and applying one to past entries,
 * shared by Settings → Rules (`src/app/actions/transaction-rules.ts`) and the phone
 * (`/api/v1/rules`), so a rule saves with the same checks from both and an apply rewrites the same rows.
 */

export class TransactionRuleError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "TransactionRuleError";
  }
}

export const MAX_TRANSACTION_RULES = 200;

export type TransactionRulePayload = z.output<typeof transactionRuleSchema>;

async function assertAccount(db: PrismaClient, userId: string, accountId: string, activeOnly: boolean) {
  const account = await db.account.findFirst({
    where: { id: accountId, userId, ...(activeOnly ? { archived: false } : {}) },
    select: { id: true },
  });
  if (!account) {
    throw new TransactionRuleError(activeOnly ? "Selected account was not found or is archived." : "Selected account was not found.");
  }
}

/** Ownership-checks a parsed rule into the columns both create and update write. @throws TransactionRuleError */
export async function prepareTransactionRule(db: PrismaClient, userId: string, payload: TransactionRulePayload) {
  let transactionType = (payload.transactionType as TransactionType | undefined) ?? null;
  if (payload.setCategoryId) {
    const category = await db.category.findFirst({
      where: { id: payload.setCategoryId, userId },
      select: { kind: true },
    });
    if (!category) throw new TransactionRuleError("Selected category was not found.");
    // Transfers have one category of their own and are left alone by rules.
    if (category.kind === "TRANSFER") throw new TransactionRuleError("Rules cannot set the transfer category.");
    // A category belongs to one side of the ledger, so the rule does too. Left on "any",
    // an expense category would silently do nothing for income and confuse the preview.
    const kind = category.kind as unknown as TransactionType;
    if (transactionType && transactionType !== kind) {
      throw new TransactionRuleError(
        `That category is for ${kind === TransactionType.EXPENSE ? "expenses" : "income"}; change the type or the category.`,
      );
    }
    transactionType = kind;
  }
  if (payload.split.length > 0) {
    const owned = await db.category.count({
      where: { userId, kind: "EXPENSE", id: { in: payload.split.map((line) => line.categoryId) } },
    });
    if (owned !== payload.split.length) throw new TransactionRuleError("A split category was not found. Reload and try again.");
    transactionType = TransactionType.EXPENSE;
  }
  await Promise.all([
    payload.matchAccountId ? assertAccount(db, userId, payload.matchAccountId, false) : undefined,
    payload.setAccountId ? assertAccount(db, userId, payload.setAccountId, true) : undefined,
    payload.setTransferAccountId ? assertAccount(db, userId, payload.setTransferAccountId, false) : undefined,
  ]);
  const tagName = payload.addTag ? normalizeTagName(payload.addTag) : "";
  if (payload.addTag && !tagName) throw new TransactionRuleError("Enter a tag name for the rule to add.");
  const [addTagId] = tagName ? await resolveTagIds(db, userId, [tagName]) : [null];

  const rule = {
    titleOperator: payload.titleOperator as TransactionRuleTextOperator,
    titlePattern: payload.titlePatterns,
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
    markAsTransfer: payload.markAsTransfer ?? false,
    setTransferAccountId: payload.setTransferAccountId ?? null,
  } satisfies Omit<Prisma.TransactionRuleUncheckedCreateInput, "userId" | "priority">;
  return { rule, split: payload.split };
}

/** The rule's split lines as the editor listed them, replacing any it had. */
export function splitRows(split: { categoryId: string; basisPoints: number }[]) {
  return split.map((line, position) => ({ position, categoryId: line.categoryId, basisPoints: line.basisPoints }));
}

/** Adds a rule after the user's others, so it runs last. @throws TransactionRuleError */
export async function createTransactionRule(db: PrismaClient, userId: string, payload: TransactionRulePayload): Promise<string> {
  const { rule: data, split } = await prepareTransactionRule(db, userId, payload);
  const [count, last] = await Promise.all([
    db.transactionRule.count({ where: { userId } }),
    db.transactionRule.findFirst({ where: { userId }, orderBy: { priority: "desc" }, select: { priority: true } }),
  ]);
  if (count >= MAX_TRANSACTION_RULES) {
    throw new TransactionRuleError(`You can have up to ${MAX_TRANSACTION_RULES} rules. Delete one you no longer need first.`);
  }
  const created = await db.transactionRule.create({
    data: { ...data, userId, priority: (last?.priority ?? -1) + 1, splits: { create: splitRows(split) } },
  });
  return created.id;
}

export async function findOwnedRule(db: PrismaClient, userId: string, ruleId: string) {
  const rule = await db.transactionRule.findFirst({ where: { id: ruleId, userId }, include: RULE_SPLITS_INCLUDE });
  if (!rule) throw new TransactionRuleError("Rule not found.", true);
  return rule;
}

/** Replaces a rule's conditions and actions, keeping its place and whether it is on. @throws TransactionRuleError */
export async function updateTransactionRule(
  db: PrismaClient,
  userId: string,
  ruleId: string,
  payload: TransactionRulePayload,
): Promise<void> {
  const rule = await findOwnedRule(db, userId, ruleId);
  const { rule: data, split } = await prepareTransactionRule(db, userId, payload);
  await db.transactionRule.update({
    where: { id: rule.id },
    data: { ...data, splits: { deleteMany: {}, create: splitRows(split) } },
  });
}

/** Deletes a rule; past transactions keep what it set. @throws TransactionRuleError */
export async function deleteTransactionRule(db: PrismaClient, userId: string, ruleId: string): Promise<void> {
  const rule = await findOwnedRule(db, userId, ruleId);
  await db.transactionRule.delete({ where: { id: rule.id } });
}

/** Turns a rule on or off. @throws TransactionRuleError */
export async function setTransactionRuleEnabled(db: PrismaClient, userId: string, ruleId: string, enabled: boolean): Promise<void> {
  const rule = await findOwnedRule(db, userId, ruleId);
  await db.transactionRule.update({ where: { id: rule.id }, data: { enabled } });
}

/**
 * Swaps a rule with its neighbour, then renumbers every rule 0..n-1 so gaps never build up. The
 * top rule moved up, or the bottom one down, stays where it is. Returns its place, from 0.
 * @throws TransactionRuleError
 */
export async function moveTransactionRule(
  db: PrismaClient,
  userId: string,
  ruleId: string,
  direction: "up" | "down",
): Promise<number> {
  return db.$transaction(async (tx) => {
    const rules = await tx.transactionRule.findMany({
      where: { userId },
      orderBy: [{ priority: "asc" }, { id: "asc" }],
      select: { id: true, priority: true },
    });
    const index = rules.findIndex((r) => r.id === ruleId);
    if (index === -1) throw new TransactionRuleError("Rule not found.", true);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rules.length) return index;
    const ordered = [...rules];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    for (const [priority, rule] of ordered.entries()) {
      if (rule.priority !== priority) {
        await tx.transactionRule.update({ where: { id: rule.id }, data: { priority } });
      }
    }
    return target;
  });
}

/** What one rule would change across every non-split transaction the user owns. @throws TransactionRuleError */
export async function planRuleChanges(db: PrismaClient, userId: string, ruleId: string): Promise<RuleChange[]> {
  const rule = toTransactionRuleInput(await findOwnedRule(db, userId, ruleId));
  const [rows, categories] = await Promise.all([
    db.transaction.findMany({
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
        _count: { select: { owedShares: true } },
      },
      orderBy: { date: "desc" },
    }),
    db.category.findMany({ where: { userId }, select: { id: true, kind: true } }),
  ]);
  const kinds = new Map(categories.map((c) => [c.id, c.kind as RuleTransactionType]));
  return planRuleApplication(
    rule,
    rows.map(({ tags, _count, ...row }) => ({
      ...row,
      tagIds: tags.map((t) => t.tagId),
      hasOwedShares: _count.owedShares > 0,
    })),
    kinds,
  );
}

/**
 * Rewrites past transactions the rule matches and returns how many. Re-plans here rather than
 * trusting a preview the person saw, so a stale preview can never write values the rule no longer
 * produces. Title, category, account, note, tag, split and transfer only — never the amount (a
 * transfer converts it to the transfer sign, the same money counted differently).
 * @throws TransactionRuleError
 */
export async function applyTransactionRule(db: PrismaClient, userId: string, ruleId: string): Promise<number> {
  const changes = await planRuleChanges(db, userId, ruleId);
  if (changes.length === 0) return 0;
  await db.$transaction(async (tx) => {
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
      if (change.splitLines) {
        await saveSplitLines(tx, { userId, transactionId: change.id, lines: change.splitLines });
      }
      if (change.addTagId) await addTagsToTransaction(tx, change.id, [change.addTagId]);
      if (change.markAsTransfer) {
        const marked = await markAsTransfer(tx, { userId, transactionId: change.id });
        if (!marked.ok) throw new TransactionRuleError("A transaction changed while the rule was applied. Try again.");
        if (change.transferAccountId) {
          await tx.transaction.update({ where: { id: change.id }, data: { transferAccountId: change.transferAccountId } });
        }
      }
    }
  }, LONG_TRANSACTION_OPTIONS);
  return changes.length;
}

/** Hides a learned Title → Category combo from the suggestions. */
export async function hideLearnedTitle(db: PrismaClient, userId: string, title: string): Promise<void> {
  const titleKey = normalizeExpenseTitleKey(title);
  await db.hiddenTitleSuggestion.upsert({
    where: { userId_titleKey: { userId, titleKey } },
    create: { userId, titleKey },
    update: {},
  });
}
