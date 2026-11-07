import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  applyTransactionRule,
  createTransactionRule,
  hideLearnedTitle,
  planRuleChanges,
  TransactionRuleError,
} from "@/lib/transaction-rule-edits";
import { resolveRuleOutcome, visibleLearnedSuggestions, type RuleTransactionType } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";
import { learnedTitleSchema, transactionRuleSchema } from "@/lib/validation";

/**
 * "Always file Tim Hortons as Coffee" from the phone: a rule made from an entry or a bank row,
 * saved by Settings → Rules' own `src/lib/transaction-rule-edits.ts`, and the learned
 * Title → Category combos no rule covers yet, offered as rules to make.
 */

const OPERATORS = { contains: "CONTAINS", is: "EQUALS", starts_with: "STARTS_WITH" } as const;

const ruleSchema = z
  .object({
    /** How the title is matched: contains, is (exactly), or starts with. */
    match: z.enum(["contains", "is", "starts_with"]).default("contains"),
    /** The texts to match; any one matching is enough. */
    texts: z.array(z.string()).min(1, "Enter the text to match."),
    type: z.enum(["expense", "income"]).optional(),
    /** Only entries on this account. */
    accountId: z.string().min(1).nullable().optional(),
    categoryId: z.string().min(1).nullable().optional(),
    rename: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
  })
  .strict();

export type ApiRefusal = { ok: false; status: 400 | 404; error: string };

/** A TransactionRuleError as the response it stands for; anything else is a bug and is rethrown. */
export function transactionRuleRefusal(err: unknown): ApiRefusal {
  if (err instanceof TransactionRuleError) return { ok: false, status: err.notFound ? 404 : 400, error: err.message };
  throw err;
}

/** Adds the rule, and says how many past entries it would change if applied. */
export async function createTransactionRuleFromApi(
  db: PrismaClient,
  userId: string,
  body: unknown,
): Promise<{ ok: true; id: string; matches: number } | ApiRefusal> {
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid rule." };
  const rule = parsed.data;
  // The website's own form schema, so the phone's rule meets the same limits.
  const payload = transactionRuleSchema.safeParse({
    titleOperator: OPERATORS[rule.match],
    titlePatterns: rule.texts,
    transactionType: rule.type?.toUpperCase(),
    matchAccountId: rule.accountId ?? undefined,
    setCategoryId: rule.categoryId ?? undefined,
    setTitle: rule.rename?.trim() || undefined,
    addTag: rule.tag?.trim() || undefined,
    split: [],
  });
  if (!payload.success) return { ok: false, status: 400, error: payload.error.issues[0]?.message ?? "Invalid rule." };
  try {
    const id = await createTransactionRule(db, userId, payload.data);
    const matches = (await planRuleChanges(db, userId, id)).length;
    return { ok: true, id, matches };
  } catch (err) {
    return transactionRuleRefusal(err);
  }
}

/** Applies a rule to past entries, as Settings → Rules' Apply does. */
export async function applyTransactionRuleFromApi(
  db: PrismaClient,
  userId: string,
  ruleId: string,
): Promise<{ ok: true; updated: number } | ApiRefusal> {
  try {
    return { ok: true, updated: await applyTransactionRule(db, userId, ruleId) };
  } catch (err) {
    return transactionRuleRefusal(err);
  }
}

/** How many suggestions an answer carries at most, the most recently used titles first. */
export const RULE_SUGGESTION_LIMIT = 60;

/**
 * The learned Title → Category combos (the latest category each expense title was filed under)
 * that are not hidden and that no rule already decides, as rules worth making.
 */
export async function loadRuleSuggestions(db: PrismaClient, userId: string) {
  const [context, categories] = await Promise.all([
    loadRuleContext(userId),
    db.category.findMany({ where: { userId }, select: { id: true, name: true, kind: true } }),
  ]);
  const kinds = new Map(categories.map((c) => [c.id, c.kind as RuleTransactionType]));
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const open = visibleLearnedSuggestions(context.learned, context.hiddenTitleKeys).filter((entry) => {
    if (kinds.get(entry.categoryId) !== "EXPENSE") return false;
    const outcome = resolveRuleOutcome(context.rules, { texts: [entry.title], amountCents: null, accountId: null, type: "EXPENSE" }, kinds);
    return outcome.categoryFrom !== "rule";
  });
  return {
    total: open.length,
    suggestions: open.slice(0, RULE_SUGGESTION_LIMIT).map((entry) => ({
      title: entry.title,
      categoryId: entry.categoryId,
      categoryName: names.get(entry.categoryId) ?? "",
    })),
  };
}

export async function hideRuleSuggestionFromApi(db: PrismaClient, userId: string, body: unknown): Promise<{ ok: true } | ApiRefusal> {
  const parsed = learnedTitleSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Name the title to hide." };
  await hideLearnedTitle(db, userId, parsed.data.title);
  return { ok: true };
}
