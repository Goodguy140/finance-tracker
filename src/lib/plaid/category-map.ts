import { CategoryKind } from "@prisma/client";

/**
 * Suggesting a category for a synced transaction.
 *
 * Only ever a *suggestion*: it is written to the staging row, and the review queue shows a
 * category picker on every line, so a wrong guess is never committed without a click. That
 * is what makes an imperfect mapping acceptable here.
 *
 * The target names are the defaults this app seeds for Canadian users
 * (`countryConfigMap.CA` in country-config.ts). The three categories that have no specific
 * home among them — GOVERNMENT_AND_NON_PROFIT, LOAN_PAYMENTS and TRANSFER_OUT — go to the
 * catch-all rather than to a category that would misreport what the spend was.
 */
export const PFC_TO_CATEGORY_NAMES: Record<string, string[]> = {
  FOOD_AND_DRINK: ["Dining", "Groceries"],
  GENERAL_MERCHANDISE: ["Fun"],
  RENT_AND_UTILITIES: ["Rent", "Utilities"],
  TRANSPORTATION: ["Transport"],
  TRAVEL: ["Transport"],
  MEDICAL: ["Health"],
  PERSONAL_CARE: ["Health"],
  ENTERTAINMENT: ["Fun"],
  GENERAL_SERVICES: ["Recurring Services"],
  BANK_FEES: ["Recurring Services"],
  HOME_IMPROVEMENT: ["Fun"],
  GOVERNMENT_AND_NON_PROFIT: ["Other"],
  LOAN_PAYMENTS: ["Other"],
  TRANSFER_OUT: ["Other"],
  INCOME: ["Salary", "Other Income"],
  TRANSFER_IN: ["Other Income"],
};

/**
 * Names an existing category can carry to serve as the catch-all.
 *
 * "Other" and "Other Income" are seeded for new users (country-config.ts), but a user may
 * have renamed theirs or predate that seed — and "Uncategorized" is what earlier versions
 * of this code created. Recognising all of them is what keeps a sync from creating yet
 * another category. Matching is per kind, so the income names can only ever claim an
 * income row.
 */
export const OTHER_CATEGORY_ALIASES = [
  "Other",
  "Miscellaneous",
  "Misc",
  "Uncategorized",
  "その他",
  "Other Income",
  "その他収入",
];

/** Created only when a user has no catch-all at all. One per kind. */
export const FALLBACK_CATEGORY_NAME = "Other";

export type UserCategory = { id: string; name: string; kind: CategoryKind };

/** A budget's own display label, when the user gave it one different from its category. */
export type UserBudgetName = { categoryId: string; name: string };

const nameKey = (value: string) => value.trim().toLowerCase();

/**
 * Resolves the category to pre-select, in order: Plaid's category mapped onto one the user
 * actually has, then the per-item default, then their catch-all, then the fallback.
 *
 * Nothing here creates a category — every step lands on something the user already owns,
 * bar the fallback, which the caller resolves (and only creates when the user has no
 * catch-all at all). The fallback is required rather than optional because
 * `Transaction.categoryId` is non-nullable with `onDelete: Restrict` — there is no "no
 * category" to fall back to.
 *
 * Budget labels are matched as well as category names: a user who renamed their monthly
 * budget to "Eating Out" while its category is still "Dining" means the same thing by it.
 *
 * Note the mapping keys on English category names, so a user whose country config seeded
 * Japanese defaults matches nothing specific and lands on their catch-all. That is
 * acceptable for a suggestion, and better than mapping by position and quietly
 * mislabelling spend.
 */
export function resolveSuggestedCategoryId(input: {
  pfcPrimary: string | null | undefined;
  kind: CategoryKind;
  userCategories: UserCategory[];
  userBudgetNames: UserBudgetName[];
  itemDefaultCategoryId: string | null;
  fallbackCategoryId: string;
}): string {
  const ofKind = input.userCategories.filter((c) => c.kind === input.kind);
  const byName = new Map(ofKind.map((c) => [nameKey(c.name), c.id]));

  // A budget label is an alternative name for its category, never a competing one: an
  // existing category of that name keeps the name.
  const idsOfKind = new Set(ofKind.map((c) => c.id));
  for (const budget of input.userBudgetNames) {
    const key = nameKey(budget.name);
    if (!key || !idsOfKind.has(budget.categoryId) || byName.has(key)) continue;
    byName.set(key, budget.categoryId);
  }

  const aliasKeys = OTHER_CATEGORY_ALIASES.map(nameKey);
  const aliasKeySet = new Set(aliasKeys);

  const primary = (input.pfcPrimary ?? "").trim().toUpperCase();
  for (const candidate of PFC_TO_CATEGORY_NAMES[primary] ?? []) {
    // A catch-all name in the mapping table is a deferral, not a match — the per-item
    // default is a deliberate choice about this connection and gets first refusal.
    const key = nameKey(candidate);
    if (aliasKeySet.has(key)) continue;
    const hit = byName.get(key);
    if (hit) return hit;
  }

  // The item default only applies to the kind it belongs to; an expense default must not
  // be pre-selected for an income row.
  if (input.itemDefaultCategoryId && idsOfKind.has(input.itemDefaultCategoryId)) {
    return input.itemDefaultCategoryId;
  }

  for (const key of aliasKeys) {
    const hit = byName.get(key);
    if (hit) return hit;
  }

  return input.fallbackCategoryId;
}
