import { CategoryKind, type PrismaClient } from "@prisma/client";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { FALLBACK_CATEGORY_NAME, OTHER_CATEGORY_ALIASES } from "@/lib/plaid/category-map";
import { parseQuickAdd, type QuickAddEntry } from "@/lib/search/quick-add";
import { describeRuleSplit, resolveRuleOutcome, type RuleTransactionType } from "@/lib/transaction-rules";
import { loadRuleContext } from "@/lib/transaction-rules-server";

/** What the master search offers to add, as saving it would book it. */
export type QuickAddPreview = QuickAddEntry & {
  categoryName: string;
  accountName: string | null;
  /** A rule's split, described, when the expense would be split. */
  split: string | null;
};

/**
 * Reads `text` as an expense to add and fills in what saving it would: the category, account
 * and rename from the user's rules and past titles, otherwise the default account and the
 * catch-all category, the same way `createTransactionFromApi` books it. Null when the text is
 * not an expense to add.
 */
export async function previewQuickAdd(
  db: PrismaClient,
  user: { id: string; timezone: string | null },
  text: string,
): Promise<QuickAddPreview | null> {
  const entry = parseQuickAdd(text, currentYmdInTimeZone(user.timezone));
  if (!entry) return null;
  const [context, categories, accounts, owner] = await Promise.all([
    loadRuleContext(user.id),
    db.category.findMany({ where: { userId: user.id, kind: CategoryKind.EXPENSE }, select: { id: true, name: true } }),
    db.account.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true } }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { defaultExpenseAccountId: true } }),
  ]);
  const outcome = resolveRuleOutcome(
    context.rules,
    { texts: [entry.title], amountCents: entry.amountCents, accountId: null, type: "EXPENSE" },
    new Map(categories.map((c) => [c.id, "EXPENSE" as RuleTransactionType])),
    { learned: context.learned, hiddenTitleKeys: context.hiddenTitleKeys },
  );
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Deleted category";
  const aliases = new Set(OTHER_CATEGORY_ALIASES.map((name) => name.trim().toLowerCase()));
  const accountId =
    (outcome.accountId && accounts.some((a) => a.id === outcome.accountId) ? outcome.accountId : null) ??
    owner.defaultExpenseAccountId;
  return {
    ...entry,
    title: outcome.title ?? entry.title,
    categoryName: outcome.categoryId
      ? categoryName(outcome.categoryId)
      : (categories.find((c) => aliases.has(c.name.trim().toLowerCase()))?.name ?? FALLBACK_CATEGORY_NAME),
    accountName: accounts.find((a) => a.id === accountId)?.name ?? null,
    split: outcome.split ? describeRuleSplit(outcome.split, categoryName) : null,
  };
}
