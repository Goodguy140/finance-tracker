import { CategoryKind } from "@prisma/client";

/**
 * Suggesting a category for a synced transaction.
 *
 * Only ever a *suggestion*: it is written to the staging row, and the review queue shows a
 * category picker on every line, so a wrong guess is never committed without a click. That
 * is what makes an imperfect mapping acceptable here.
 *
 * The target names are the defaults this app seeds for Canadian users
 * (`countryConfigMap.CA` in country-config.ts). Several Plaid categories intentionally map
 * to nothing: LOAN_PAYMENTS and TRANSFER_OUT have no sensible home among them, and
 * inventing one would be worse than leaving it uncategorised for the user to decide.
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
  GOVERNMENT_AND_NON_PROFIT: [],
  LOAN_PAYMENTS: [],
  TRANSFER_OUT: [],
  INCOME: ["Salary", "Other Income"],
  TRANSFER_IN: ["Other Income"],
};

/** The lazily-created home for anything that does not map. One per kind. */
export const UNCATEGORIZED_NAME = "Uncategorized";

export type UserCategory = { id: string; name: string; kind: CategoryKind };

/**
 * Resolves the category to pre-select, in order: Plaid's category mapped onto one the user
 * actually has, then the per-item default, then the fallback.
 *
 * The fallback is required rather than optional because `Transaction.categoryId` is
 * non-nullable with `onDelete: Restrict` — there is no "no category" to fall back to.
 *
 * Note the mapping keys on English category names, so a user whose country config seeded
 * Japanese defaults matches nothing and lands on the fallback. That is acceptable for a
 * suggestion, and better than mapping by position and quietly mislabelling spend.
 */
export function resolveSuggestedCategoryId(input: {
  pfcPrimary: string | null | undefined;
  kind: CategoryKind;
  userCategories: UserCategory[];
  itemDefaultCategoryId: string | null;
  fallbackCategoryId: string;
}): string {
  const ofKind = input.userCategories.filter((c) => c.kind === input.kind);
  const byName = new Map(ofKind.map((c) => [c.name.trim().toLowerCase(), c.id]));

  const primary = (input.pfcPrimary ?? "").trim().toUpperCase();
  for (const candidate of PFC_TO_CATEGORY_NAMES[primary] ?? []) {
    const hit = byName.get(candidate.trim().toLowerCase());
    if (hit) return hit;
  }

  // The item default only applies to the kind it belongs to; an expense default must not
  // be pre-selected for an income row.
  if (input.itemDefaultCategoryId && ofKind.some((c) => c.id === input.itemDefaultCategoryId)) {
    return input.itemDefaultCategoryId;
  }

  return input.fallbackCategoryId;
}
