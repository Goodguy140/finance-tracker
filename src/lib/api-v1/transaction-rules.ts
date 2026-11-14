import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { homeCurrencyOf } from "@/lib/home-currency";
import { formatCurrency } from "@/lib/money";
import {
  applyTransactionRule,
  createTransactionRule,
  deleteTransactionRule,
  findOwnedRule,
  hideLearnedTitle,
  MAX_TRANSACTION_RULES,
  moveTransactionRule,
  planRuleChanges,
  setTransactionRuleEnabled,
  TransactionRuleError,
  updateTransactionRule,
} from "@/lib/transaction-rule-edits";
import {
  describeRuleActions,
  describeRuleCondition,
  resolveRuleOutcome,
  ruleTitlePatterns,
  visibleLearnedSuggestions,
  type RuleTransactionType,
} from "@/lib/transaction-rules";
import { loadRuleContext, RULE_SPLITS_INCLUDE, toTransactionRuleInput } from "@/lib/transaction-rules-server";
import { learnedTitleSchema, transactionRuleSchema } from "@/lib/validation";

/**
 * "Always file Tim Hortons as Coffee" from the phone: a rule made from an entry or a bank row,
 * saved by Settings → Rules' own `src/lib/transaction-rule-edits.ts`; the person's rules, to
 * change, turn off, reorder or delete; and the learned Title → Category combos no rule covers yet,
 * offered as rules to make.
 */

const OPERATORS = { contains: "CONTAINS", is: "EQUALS", starts_with: "STARTS_WITH" } as const;
const MATCHES = { CONTAINS: "contains", EQUALS: "is", STARTS_WITH: "starts_with" } as const;

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

type RuleRow = Awaited<ReturnType<typeof findOwnedRule>>;
type RuleUser = { id: string; countryCode: string | null };

/** The names Settings → Rules describes a rule with, the user's own. */
async function ruleLabels(db: PrismaClient, user: RuleUser) {
  const [categories, accounts, tags] = await Promise.all([
    db.category.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
    db.account.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
    db.tag.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
  ]);
  const names = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
  const [categoryNames, accountNames, tagNames] = [names(categories), names(accounts), names(tags)];
  const currency = homeCurrencyOf(user.countryCode);
  return {
    category: (id: string) => categoryNames.get(id) ?? "Deleted category",
    account: (id: string) => accountNames.get(id) ?? "Deleted account",
    tag: (id: string) => tagNames.get(id) ?? "Deleted tag",
    amount: (cents: number) => formatCurrency(cents, currency),
    tagName: (id: string) => tagNames.get(id) ?? null,
  };
}

/** What a rule does that only the website's editor sets; a change from the phone keeps them as they are. */
function websiteOnlySettings(rule: RuleRow): string[] {
  return [
    rule.minAmountCents !== null || rule.maxAmountCents !== null ? "an amount range" : null,
    rule.splits.length > 0 ? "a split" : null,
    rule.setAmountCents !== null ? "a new amount" : null,
    rule.setAccountId ? "a new account" : null,
    rule.appendNote ? "a note" : null,
    rule.markAsTransfer ? "marking as a transfer" : null,
  ].filter((part): part is string => part !== null);
}

/** One rule as the phone lists and edits it: Settings → Rules' description, and the fields the phone changes. */
function serializeAppRule(rule: RuleRow, position: number, labels: Awaited<ReturnType<typeof ruleLabels>>) {
  const input = toTransactionRuleInput(rule);
  return {
    id: rule.id,
    enabled: rule.enabled,
    /** Its place in the order the rules run, from 1. */
    position,
    condition: describeRuleCondition(input, labels),
    actions: describeRuleActions(input, labels),
    match: MATCHES[rule.titleOperator],
    texts: ruleTitlePatterns(rule.titlePattern),
    type: rule.transactionType === "EXPENSE" ? ("expense" as const) : rule.transactionType === "INCOME" ? ("income" as const) : null,
    accountId: rule.matchAccountId,
    categoryId: rule.setCategoryId,
    rename: rule.setTitle,
    tag: rule.addTagId ? labels.tagName(rule.addTagId) : null,
    alsoOnWebsite: websiteOnlySettings(rule),
  };
}

export type AppRule = ReturnType<typeof serializeAppRule>;

function loadRuleRows(db: PrismaClient, userId: string) {
  return db.transactionRule.findMany({
    where: { userId },
    include: RULE_SPLITS_INCLUDE,
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });
}

/** `GET /api/v1/rules`: every rule in the order they run, as Settings → Rules lists them. */
export async function loadAppRules(db: PrismaClient, user: RuleUser) {
  const [rows, labels] = await Promise.all([loadRuleRows(db, user.id), ruleLabels(db, user)]);
  return { max: MAX_TRANSACTION_RULES, rules: rows.map((row, i) => serializeAppRule(row, i + 1, labels)) };
}

/**
 * One rule, out of how many, and with `withMatches` how many past entries applying it would change
 * (Settings → Rules' Apply to past preview). Null when the user has no such rule.
 */
export async function loadAppRule(db: PrismaClient, user: RuleUser, ruleId: string, withMatches: boolean) {
  const [rows, labels] = await Promise.all([loadRuleRows(db, user.id), ruleLabels(db, user)]);
  const index = rows.findIndex((row) => row.id === ruleId);
  if (index === -1) return null;
  return {
    rule: serializeAppRule(rows[index], index + 1, labels),
    count: rows.length,
    matches: withMatches ? (await planRuleChanges(db, user.id, ruleId)).length : null,
  };
}

const rulePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    match: z.enum(["contains", "is", "starts_with"]).optional(),
    texts: z.array(z.string()).min(1, "Enter the text to match.").optional(),
    /** null matches expenses and income alike. */
    type: z.enum(["expense", "income"]).nullable().optional(),
    accountId: z.string().min(1).nullable().optional(),
    categoryId: z.string().min(1).nullable().optional(),
    rename: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), "Send what to change.");

/**
 * Changes a rule from the phone. Only what the body names changes; the settings only the website
 * edits (amounts, a split, a new account or amount, a note, transfers) are carried over, and the
 * whole rule is checked again by Settings → Rules' own schema and checks. Says whether anything
 * besides on/off changed.
 */
export async function patchTransactionRuleFromApi(
  db: PrismaClient,
  userId: string,
  ruleId: string,
  body: unknown,
): Promise<{ ok: true; changedRule: boolean } | ApiRefusal> {
  const parsed = rulePatchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid change." };
  const { enabled, ...edits } = parsed.data;
  const changedRule = Object.values(edits).some((value) => value !== undefined);
  try {
    const rule = await findOwnedRule(db, userId, ruleId);
    if (changedRule) {
      const tagName = rule.addTagId
        ? (await db.tag.findFirst({ where: { id: rule.addTagId, userId }, select: { name: true } }))?.name
        : undefined;
      const keptType = rule.transactionType === "EXPENSE" || rule.transactionType === "INCOME" ? rule.transactionType : undefined;
      const dollars = (cents: number | null) => (cents === null ? undefined : cents / 100);
      const payload = transactionRuleSchema.safeParse({
        titleOperator: edits.match ? OPERATORS[edits.match] : rule.titleOperator,
        titlePatterns: edits.texts ?? ruleTitlePatterns(rule.titlePattern),
        transactionType: edits.type !== undefined ? edits.type?.toUpperCase() : keptType,
        matchAccountId: edits.accountId !== undefined ? (edits.accountId ?? undefined) : (rule.matchAccountId ?? undefined),
        minAmount: dollars(rule.minAmountCents),
        maxAmount: dollars(rule.maxAmountCents),
        setCategoryId: edits.categoryId !== undefined ? (edits.categoryId ?? undefined) : (rule.setCategoryId ?? undefined),
        setTitle: edits.rename !== undefined ? edits.rename?.trim() || undefined : (rule.setTitle ?? undefined),
        setAmount: dollars(rule.setAmountCents),
        setAccountId: rule.setAccountId ?? undefined,
        appendNote: rule.appendNote ?? undefined,
        addTag: edits.tag !== undefined ? edits.tag?.trim() || undefined : tagName,
        markAsTransfer: rule.markAsTransfer || undefined,
        setTransferAccountId: rule.setTransferAccountId ?? undefined,
        // Stored in hundredths of a percent; the schema takes percent, as typed on the website.
        split: rule.splits.map((line) => ({ categoryId: line.categoryId, basisPoints: line.basisPoints / 100 })),
      });
      if (!payload.success) return { ok: false, status: 400, error: payload.error.issues[0]?.message ?? "Invalid rule." };
      await updateTransactionRule(db, userId, rule.id, payload.data);
    }
    if (enabled !== undefined) await setTransactionRuleEnabled(db, userId, rule.id, enabled);
    return { ok: true, changedRule };
  } catch (err) {
    return transactionRuleRefusal(err);
  }
}

export async function deleteTransactionRuleFromApi(db: PrismaClient, userId: string, ruleId: string): Promise<{ ok: true } | ApiRefusal> {
  try {
    await deleteTransactionRule(db, userId, ruleId);
    return { ok: true };
  } catch (err) {
    return transactionRuleRefusal(err);
  }
}

const moveSchema = z.object({ direction: z.enum(["up", "down"], "'direction' must be up or down.") }).strict();

/** Swaps a rule with the one above or below it, as Settings → Rules' arrows do; says where it is now, from 1. */
export async function moveTransactionRuleFromApi(
  db: PrismaClient,
  userId: string,
  ruleId: string,
  body: unknown,
): Promise<{ ok: true; position: number } | ApiRefusal> {
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid move." };
  try {
    return { ok: true, position: (await moveTransactionRule(db, userId, ruleId, parsed.data.direction)) + 1 };
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
