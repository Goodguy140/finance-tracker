import { CategoryKind } from "@prisma/client";
import { canonicalDetailedCode } from "@/lib/plaid/category-taxonomy";

/**
 * Suggesting a category for a synced transaction.
 *
 * Only ever a *suggestion*: it is written to the staging row, and the review queue shows a
 * category picker on every line, so a wrong guess is never committed without a click. That
 * is what makes an imperfect mapping acceptable here.
 *
 * The target names are the defaults this app seeds for Canadian users
 * (`countryConfigMap.CA` in country-config.ts). The two categories that have no specific
 * home among them — GOVERNMENT_AND_NON_PROFIT and LOAN_PAYMENTS — go to the catch-all rather
 * than to a category that would misreport what the spend was.
 *
 * TRANSFER_IN and TRANSFER_OUT are absent: those rows are staged as transfers
 * (`isPlaidTransfer`), which have one category of their own.
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
  INCOME: ["Salary", "Other Income"],
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

/** The user's own Plaid code → category choices (PlaidCategoryMapping rows). */
export type UserPlaidMapping = { plaidCategory: string; categoryId: string };

const nameKey = (value: string) => value.trim().toLowerCase();

/** The user's categories of one kind by lowercased name, budget labels included. */
function namesOfKind(input: { kind: CategoryKind; userCategories: UserCategory[]; userBudgetNames: UserBudgetName[] }) {
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
  return { byName, idsOfKind };
}

/**
 * The category the built-in name map picks for a Plaid primary, among the user's own
 * categories of `kind` — or undefined when it lands on nothing specific.
 *
 * Budget labels are matched as well as category names: a user who renamed their monthly
 * budget to "Eating Out" while its category is still "Dining" means the same thing by it.
 *
 * Note the mapping keys on English category names, so a user whose country config seeded
 * Japanese defaults matches nothing specific and lands on their catch-all. That is
 * acceptable for a suggestion, and better than mapping by position and quietly
 * mislabelling spend — and the user can now say what they mean in Settings → Categories.
 */
export function builtInCategoryIdFor(input: {
  pfcPrimary: string | null | undefined;
  kind: CategoryKind;
  userCategories: UserCategory[];
  userBudgetNames: UserBudgetName[];
}): string | undefined {
  const { byName } = namesOfKind(input);
  const aliasKeySet = new Set(OTHER_CATEGORY_ALIASES.map(nameKey));
  const primary = (input.pfcPrimary ?? "").trim().toUpperCase();
  for (const candidate of PFC_TO_CATEGORY_NAMES[primary] ?? []) {
    // A catch-all name in the mapping table is a deferral, not a match — the per-item
    // default is a deliberate choice about this connection and gets first refusal.
    const key = nameKey(candidate);
    if (aliasKeySet.has(key)) continue;
    const hit = byName.get(key);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The category the user mapped this Plaid category to, if any: the detailed code's mapping
 * first, then its primary's. A mapping to a category of the wrong kind is passed over — an
 * expense category must never be pre-selected for an income row.
 */
export function userMappedCategoryId(input: {
  pfcPrimary: string | null | undefined;
  pfcDetailed: string | null | undefined;
  kind: CategoryKind;
  userCategories: UserCategory[];
  userMappings: UserPlaidMapping[];
}): string | undefined {
  if (input.userMappings.length === 0) return undefined;
  const primary = (input.pfcPrimary ?? "").trim().toUpperCase();
  if (!primary) return undefined;
  const idsOfKind = new Set(input.userCategories.filter((c) => c.kind === input.kind).map((c) => c.id));
  const byCode = new Map(input.userMappings.map((m) => [m.plaidCategory, m.categoryId]));
  for (const code of [canonicalDetailedCode(primary, input.pfcDetailed), primary]) {
    const hit = code ? byCode.get(code) : undefined;
    if (hit && idsOfKind.has(hit)) return hit;
  }
  return undefined;
}

/**
 * Resolves the category to pre-select, in order: the user's own mapping for this Plaid
 * category (detailed, then primary), then Plaid's category mapped by name onto one the user
 * actually has, then the per-item default, then their catch-all, then the fallback.
 *
 * The user's mapping comes before the per-item default because it is the more specific
 * statement: "groceries are Groceries" says more than "this bank's rows are usually Fun".
 *
 * Nothing here creates a category — every step lands on something the user already owns,
 * bar the fallback, which the caller resolves (and only creates when the user has no
 * catch-all at all). The fallback is required rather than optional because
 * `Transaction.categoryId` is non-nullable with `onDelete: Restrict` — there is no "no
 * category" to fall back to.
 */
export function resolveSuggestedCategoryId(input: {
  pfcPrimary: string | null | undefined;
  pfcDetailed?: string | null | undefined;
  kind: CategoryKind;
  userCategories: UserCategory[];
  userBudgetNames: UserBudgetName[];
  userMappings?: UserPlaidMapping[];
  itemDefaultCategoryId: string | null;
  fallbackCategoryId: string;
}): string {
  const mapped = userMappedCategoryId({
    pfcPrimary: input.pfcPrimary,
    pfcDetailed: input.pfcDetailed,
    kind: input.kind,
    userCategories: input.userCategories,
    userMappings: input.userMappings ?? [],
  });
  if (mapped) return mapped;

  const builtIn = builtInCategoryIdFor(input);
  if (builtIn) return builtIn;

  const { byName, idsOfKind } = namesOfKind(input);
  // The item default only applies to the kind it belongs to; an expense default must not
  // be pre-selected for an income row.
  if (input.itemDefaultCategoryId && idsOfKind.has(input.itemDefaultCategoryId)) {
    return input.itemDefaultCategoryId;
  }

  for (const alias of OTHER_CATEGORY_ALIASES) {
    const hit = byName.get(nameKey(alias));
    if (hit) return hit;
  }

  return input.fallbackCategoryId;
}

/** The user's catch-all among `categories` (one kind's), in alias order; undefined if none. */
export function catchAllCategoryId(categories: readonly { id: string; name: string }[]): string | undefined {
  const byName = new Map(categories.map((c) => [nameKey(c.name), c.id]));
  for (const alias of OTHER_CATEGORY_ALIASES) {
    const hit = byName.get(nameKey(alias));
    if (hit) return hit;
  }
  return undefined;
}
