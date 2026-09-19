import { CategoryKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { countryConfigMap } from "@/lib/country-config";
import {
  PFC_TO_CATEGORY_NAMES,
  resolveSuggestedCategoryId,
  type UserCategory,
} from "@/lib/plaid/category-map";

const EXPENSE_CATEGORIES: UserCategory[] = countryConfigMap.CA.defaultExpenseCategories.map(
  (name, i) => ({ id: `exp-${i}`, name, kind: CategoryKind.EXPENSE }),
);
const INCOME_CATEGORIES: UserCategory[] = countryConfigMap.CA.defaultIncomeCategories.map(
  (name, i) => ({ id: `inc-${i}`, name, kind: CategoryKind.INCOME }),
);
const ALL = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

function idOf(name: string): string {
  return ALL.find((c) => c.name === name)!.id;
}

function resolve(
  pfcPrimary: string | null,
  kind: CategoryKind = CategoryKind.EXPENSE,
  itemDefault: string | null = null,
) {
  return resolveSuggestedCategoryId({
    pfcPrimary,
    kind,
    userCategories: ALL,
    itemDefaultCategoryId: itemDefault,
    fallbackCategoryId: "fallback",
  });
}

describe("PFC_TO_CATEGORY_NAMES", () => {
  it("only ever names categories this app actually seeds", () => {
    // A typo here would silently degrade to "Uncategorized" for a whole Plaid category,
    // which is exactly the kind of thing nobody notices.
    const seeded = new Set<string>([
      ...countryConfigMap.CA.defaultExpenseCategories,
      ...countryConfigMap.CA.defaultIncomeCategories,
    ]);
    for (const [primary, names] of Object.entries(PFC_TO_CATEGORY_NAMES)) {
      for (const name of names) {
        expect(seeded.has(name), `${primary} -> "${name}" is not a seeded category`).toBe(true);
      }
    }
  });
});

describe("resolveSuggestedCategoryId", () => {
  it("maps Plaid's categories onto the user's own", () => {
    expect(resolve("FOOD_AND_DRINK")).toBe(idOf("Dining"));
    expect(resolve("TRANSPORTATION")).toBe(idOf("Transport"));
    expect(resolve("RENT_AND_UTILITIES")).toBe(idOf("Rent"));
    expect(resolve("MEDICAL")).toBe(idOf("Health"));
    expect(resolve("BANK_FEES")).toBe(idOf("Recurring Services"));
  });

  it("maps income categories against income kinds", () => {
    expect(resolve("INCOME", CategoryKind.INCOME)).toBe(idOf("Salary"));
    expect(resolve("TRANSFER_IN", CategoryKind.INCOME)).toBe(idOf("Other Income"));
  });

  it("is case and whitespace insensitive on Plaid's value", () => {
    expect(resolve("  food_and_drink  ")).toBe(idOf("Dining"));
  });

  it("falls through the preference list when the first choice is missing", () => {
    // FOOD_AND_DRINK prefers Dining, then Groceries.
    const withoutDining = ALL.filter((c) => c.name !== "Dining");
    expect(
      resolveSuggestedCategoryId({
        pfcPrimary: "FOOD_AND_DRINK",
        kind: CategoryKind.EXPENSE,
        userCategories: withoutDining,
        itemDefaultCategoryId: null,
        fallbackCategoryId: "fallback",
      }),
    ).toBe(idOf("Groceries"));
  });

  it("uses the fallback for categories deliberately left unmapped", () => {
    // LOAN_PAYMENTS and TRANSFER_OUT have no honest home among the seeded categories.
    expect(resolve("LOAN_PAYMENTS")).toBe("fallback");
    expect(resolve("TRANSFER_OUT")).toBe("fallback");
    expect(resolve("GOVERNMENT_AND_NON_PROFIT")).toBe("fallback");
  });

  it("uses the fallback for an unknown or absent Plaid category", () => {
    expect(resolve("SOMETHING_NEW_PLAID_ADDED")).toBe("fallback");
    expect(resolve(null)).toBe("fallback");
    expect(resolve("")).toBe("fallback");
  });

  it("prefers the item default over the fallback when nothing maps", () => {
    expect(resolve("LOAN_PAYMENTS", CategoryKind.EXPENSE, idOf("Fun"))).toBe(idOf("Fun"));
  });

  it("ignores an item default belonging to the wrong kind", () => {
    // An expense default must never be pre-selected for an income row.
    expect(resolve("TRANSFER_OUT", CategoryKind.INCOME, idOf("Fun"))).toBe("fallback");
  });

  it("ignores an item default that no longer exists", () => {
    expect(resolve("LOAN_PAYMENTS", CategoryKind.EXPENSE, "deleted-category")).toBe("fallback");
  });

  it("never returns an expense category for an income row", () => {
    const expenseIds = new Set(EXPENSE_CATEGORIES.map((c) => c.id));
    for (const primary of Object.keys(PFC_TO_CATEGORY_NAMES)) {
      const resolved = resolve(primary, CategoryKind.INCOME);
      expect(expenseIds.has(resolved)).toBe(false);
    }
  });

  it("lands on the fallback for a user seeded with non-English categories", () => {
    // The map keys on English names, so a JP-seeded user matches nothing. Acceptable for
    // a suggestion the user confirms, and better than mislabelling their spend.
    const jp: UserCategory[] = countryConfigMap.JP.defaultExpenseCategories.map((name, i) => ({
      id: `jp-${i}`,
      name,
      kind: CategoryKind.EXPENSE,
    }));
    expect(
      resolveSuggestedCategoryId({
        pfcPrimary: "FOOD_AND_DRINK",
        kind: CategoryKind.EXPENSE,
        userCategories: jp,
        itemDefaultCategoryId: null,
        fallbackCategoryId: "fallback",
      }),
    ).toBe("fallback");
  });
});
