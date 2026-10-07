import { PlaidStagedStatus, TransactionType, type Prisma, type PrismaClient } from "@prisma/client";
import { selectActiveBudgetsByCategory } from "@/lib/budget-progress";
import { currentYmInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import {
  resolveSuggestedCategoryId,
  type UserBudgetName,
  type UserCategory,
  type UserPlaidMapping,
} from "@/lib/plaid/category-map";

type Client = PrismaClient | Prisma.TransactionClient;

export type CategorySuggestionContext = {
  categories: UserCategory[];
  /** Custom labels on the budgets active this month, matched as category aliases. */
  budgetNames: UserBudgetName[];
  plaidMappings: UserPlaidMapping[];
};

/** What suggesting a category for a Plaid row needs to know about the user, read in one go. */
export async function loadCategorySuggestionContext(
  userId: string,
  timezone: string,
  client: Client = prisma,
): Promise<CategorySuggestionContext> {
  const [categories, budgets, plaidMappings] = await Promise.all([
    client.category.findMany({
      where: { userId },
      select: { id: true, name: true, kind: true },
    }),
    client.budget.findMany({
      where: { userId },
      select: { categoryId: true, name: true, periodMonth: true },
    }),
    client.plaidCategoryMapping.findMany({
      where: { userId },
      select: { plaidCategory: true, categoryId: true },
    }),
  ]);

  // Which budget is in force is decided first, then labels are taken from it — picking
  // the labelled ones first would resurrect a name the user has since moved on from.
  const budgetNames: UserBudgetName[] = [];
  for (const budget of selectActiveBudgetsByCategory(budgets, currentYmInTimeZone(timezone)).values()) {
    if (budget.name) budgetNames.push({ categoryId: budget.categoryId, name: budget.name });
  }

  return { categories, budgetNames, plaidMappings };
}

/**
 * Re-runs the category suggestion on every row still waiting for review, after the user
 * changed what a suggestion depends on (a Plaid mapping, or a category merged or deleted).
 * Without it the queue keeps proposing what the old settings said until the bank happens
 * to revise each row.
 *
 * Only NEEDS_REVIEW rows: anything decided already has its category on the committed
 * transaction, and a staged suggestion is never the user's own choice — the queue's picker
 * is not saved back — so nothing a person picked is overwritten. Transfers are left alone;
 * they have one category of their own.
 *
 * Returns how many rows changed.
 */
export async function resuggestStagedCategories(
  userId: string,
  timezone: string,
  client: Client = prisma,
): Promise<number> {
  const rows = await client.plaidStagedTransaction.findMany({
    where: {
      userId,
      status: PlaidStagedStatus.NEEDS_REVIEW,
      type: { in: [TransactionType.EXPENSE, TransactionType.INCOME] },
    },
    select: {
      id: true,
      type: true,
      pfcPrimary: true,
      pfcDetailed: true,
      suggestedCategoryId: true,
      plaidItem: { select: { defaultCategoryId: true } },
    },
  });
  if (rows.length === 0) return 0;

  const context = await loadCategorySuggestionContext(userId, timezone, client);
  const ownedIds = new Set(context.categories.map((c) => c.id));
  let changed = 0;
  for (const row of rows) {
    // The fallback is the row's current suggestion, so a user with no catch-all keeps what
    // they had rather than a category being invented here. One that no longer exists falls
    // to null, which the queue resolves to the catch-all when it renders.
    const current = row.suggestedCategoryId && ownedIds.has(row.suggestedCategoryId) ? row.suggestedCategoryId : "";
    const next =
      resolveSuggestedCategoryId({
        pfcPrimary: row.pfcPrimary,
        pfcDetailed: row.pfcDetailed,
        // The two enums share their values for EXPENSE and INCOME.
        kind: row.type === TransactionType.INCOME ? "INCOME" : "EXPENSE",
        userCategories: context.categories,
        userBudgetNames: context.budgetNames,
        userMappings: context.plaidMappings,
        itemDefaultCategoryId: row.plaidItem.defaultCategoryId,
        fallbackCategoryId: current,
      }) || null;
    if (next === row.suggestedCategoryId) continue;
    await client.plaidStagedTransaction.update({ where: { id: row.id }, data: { suggestedCategoryId: next } });
    changed += 1;
  }
  return changed;
}
