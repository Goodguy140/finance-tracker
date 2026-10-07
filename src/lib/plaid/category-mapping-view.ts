import { CategoryKind } from "@prisma/client";
import {
  builtInCategoryIdFor,
  catchAllCategoryId,
  type UserBudgetName,
  type UserCategory,
  type UserPlaidMapping,
} from "@/lib/plaid/category-map";
import { PLAID_CATEGORY_TAXONOMY, plaidCategoryLabel } from "@/lib/plaid/category-taxonomy";

export type PlaidMappingRowView = {
  code: string;
  label: string;
  mappedCategoryId: string | null;
  defaultLabel: string;
};

export type PlaidMappingGroupView = PlaidMappingRowView & {
  kind: "EXPENSE" | "INCOME";
  detailed: PlaidMappingRowView[];
};

/**
 * The Settings → Categories view of every Plaid category: what the user mapped it to, and
 * what applies when they have not, so the default is visible before anyone changes it.
 *
 * A mapping to a category of the wrong kind, or one that no longer exists, is shown as
 * unmapped: that is how `userMappedCategoryId` treats it too.
 */
export function buildPlaidMappingView(input: {
  categories: UserCategory[];
  budgetNames: UserBudgetName[];
  mappings: UserPlaidMapping[];
}): PlaidMappingGroupView[] {
  const nameById = new Map(input.categories.map((c) => [c.id, c.name]));
  const kindById = new Map(input.categories.map((c) => [c.id, c.kind]));
  const mappedByCode = new Map(input.mappings.map((m) => [m.plaidCategory, m.categoryId]));

  return PLAID_CATEGORY_TAXONOMY.map((group) => {
    const kind = group.kind === CategoryKind.INCOME ? "INCOME" : "EXPENSE";
    const mappedFor = (code: string) => {
      const id = mappedByCode.get(code);
      return id && kindById.get(id) === group.kind ? id : null;
    };

    const builtIn = builtInCategoryIdFor({
      pfcPrimary: group.primary,
      kind: group.kind,
      userCategories: input.categories,
      userBudgetNames: input.budgetNames,
    });
    const catchAll = catchAllCategoryId(input.categories.filter((c) => c.kind === group.kind));
    const defaultName = nameById.get(builtIn ?? catchAll ?? "") ?? "your catch-all";

    const primaryMapped = mappedFor(group.primary);
    const primaryLabel = plaidCategoryLabel(group.primary);
    const effectivePrimaryName = primaryMapped ? nameById.get(primaryMapped) : defaultName;

    return {
      code: group.primary,
      label: primaryLabel,
      kind,
      mappedCategoryId: primaryMapped,
      defaultLabel: `Default: ${defaultName}`,
      detailed: group.detailed.map((code) => ({
        code,
        label: plaidCategoryLabel(code, group.primary),
        mappedCategoryId: mappedFor(code),
        // Short, so it fits the select: the row sits under its primary, which says where it comes from.
        defaultLabel: `Default: ${effectivePrimaryName}`,
      })),
    };
  });
}
