import { CategoryKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { countryConfigMap } from "@/lib/country-config";
import {
  PFC_TO_CATEGORY_NAMES,
  resolveSuggestedCategoryId,
  type UserBudgetName,
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
  budgetNames: UserBudgetName[] = [],
) {
  return resolveSuggestedCategoryId({
    pfcPrimary,
    kind,
    userCategories: ALL,
    userBudgetNames: budgetNames,
    itemDefaultCategoryId: itemDefault,
    fallbackCategoryId: "fallback",
  });
}

describe("PFC_TO_CATEGORY_NAMES", () => {
  it("only ever names categories this app actually seeds", () => {
    // A typo here would silently degrade to the catch-all for a whole Plaid category,
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
        userBudgetNames: [],
        itemDefaultCategoryId: null,
        fallbackCategoryId: "fallback",
      }),
    ).toBe(idOf("Groceries"));
  });

  it("sends categories with no specific home to the user's catch-all", () => {
    expect(resolve("LOAN_PAYMENTS")).toBe(idOf("Other"));
    expect(resolve("TRANSFER_OUT")).toBe(idOf("Other"));
    expect(resolve("GOVERNMENT_AND_NON_PROFIT")).toBe(idOf("Other"));
  });

  it("sends an unknown or absent Plaid category to the catch-all", () => {
    expect(resolve("SOMETHING_NEW_PLAID_ADDED")).toBe(idOf("Other"));
    expect(resolve(null)).toBe(idOf("Other"));
    expect(resolve("")).toBe(idOf("Other"));
  });

  it("recognises a catch-all the user named differently", () => {
    // Including "Uncategorized", which earlier versions of the sync created.
    for (const alias of ["Miscellaneous", "Misc", "uncategorized"]) {
      const categories: UserCategory[] = [{ id: "catch-all", name: alias, kind: CategoryKind.EXPENSE }];
      expect(
        resolveSuggestedCategoryId({
          pfcPrimary: "LOAN_PAYMENTS",
          kind: CategoryKind.EXPENSE,
          userCategories: categories,
          userBudgetNames: [],
          itemDefaultCategoryId: null,
          fallbackCategoryId: "fallback",
        }),
      ).toBe("catch-all");
    }
  });

  it("uses the fallback only when the user has no catch-all at all", () => {
    const withoutOther = ALL.filter((c) => c.name !== "Other");
    expect(
      resolveSuggestedCategoryId({
        pfcPrimary: "LOAN_PAYMENTS",
        kind: CategoryKind.EXPENSE,
        userCategories: withoutOther,
        userBudgetNames: [],
        itemDefaultCategoryId: null,
        fallbackCategoryId: "fallback",
      }),
    ).toBe("fallback");
  });

  it("prefers the item default over the catch-all when nothing maps", () => {
    // The default is a deliberate choice about one connection; the catch-all is a shrug.
    expect(resolve("LOAN_PAYMENTS", CategoryKind.EXPENSE, idOf("Fun"))).toBe(idOf("Fun"));
  });

  it("prefers a mapped category over the item default", () => {
    expect(resolve("FOOD_AND_DRINK", CategoryKind.EXPENSE, idOf("Fun"))).toBe(idOf("Dining"));
  });

  it("ignores an item default belonging to the wrong kind", () => {
    // An expense default must never be pre-selected for an income row; the income
    // catch-all takes it instead.
    expect(resolve("TRANSFER_OUT", CategoryKind.INCOME, idOf("Fun"))).toBe(idOf("Other Income"));
  });

  it("ignores an item default that no longer exists", () => {
    expect(resolve("LOAN_PAYMENTS", CategoryKind.EXPENSE, "deleted-category")).toBe(idOf("Other"));
  });

  it("never returns an expense category for an income row", () => {
    const expenseIds = new Set(EXPENSE_CATEGORIES.map((c) => c.id));
    for (const primary of Object.keys(PFC_TO_CATEGORY_NAMES)) {
      const resolved = resolve(primary, CategoryKind.INCOME);
      expect(expenseIds.has(resolved)).toBe(false);
    }
  });

  it("matches a budget's own label when its category is named something else", () => {
    const categories: UserCategory[] = [
      { id: "cat-food", name: "Food Stuff", kind: CategoryKind.EXPENSE },
      { id: "cat-other", name: "Other", kind: CategoryKind.EXPENSE },
    ];
    expect(
      resolveSuggestedCategoryId({
        pfcPrimary: "FOOD_AND_DRINK",
        kind: CategoryKind.EXPENSE,
        userCategories: categories,
        userBudgetNames: [{ categoryId: "cat-food", name: "Dining" }],
        itemDefaultCategoryId: null,
        fallbackCategoryId: "fallback",
      }),
    ).toBe("cat-food");
  });

  it("lets a category keep its own name against a budget label that claims it", () => {
    expect(resolve("FOOD_AND_DRINK", CategoryKind.EXPENSE, null, [
      { categoryId: idOf("Fun"), name: "Dining" },
    ])).toBe(idOf("Dining"));
  });

  it("lands an unmapped income row on the seeded income catch-all rather than creating one", () => {
    expect(resolve("SOMETHING_NEW_PLAID_ADDED", CategoryKind.INCOME)).toBe(idOf("Other Income"));
  });

  it("ignores a budget label on a category of the wrong kind", () => {
    // Without the kind filter this would pre-select an expense category for an income row.
    const categories: UserCategory[] = [
      { id: "inc-wages", name: "Wages", kind: CategoryKind.INCOME },
      { id: "exp-fun", name: "Fun", kind: CategoryKind.EXPENSE },
    ];
    expect(
      resolveSuggestedCategoryId({
        pfcPrimary: "INCOME",
        kind: CategoryKind.INCOME,
        userCategories: categories,
        userBudgetNames: [{ categoryId: "exp-fun", name: "Salary" }],
        itemDefaultCategoryId: null,
        fallbackCategoryId: "fallback",
      }),
    ).toBe("fallback");
  });

  it("ignores a budget label whose category the user has deleted", () => {
    expect(
      resolve("LOAN_PAYMENTS", CategoryKind.EXPENSE, null, [
        { categoryId: "deleted-category", name: "Loans" },
      ]),
    ).toBe(idOf("Other"));
  });

  it("lands on the catch-all for a user seeded with non-English categories", () => {
    // The map keys on English names, so a JP-seeded user matches nothing specific — but
    // their own "その他" is a catch-all, so the suggestion stays inside their categories.
    const jp: UserCategory[] = countryConfigMap.JP.defaultExpenseCategories.map((name, i) => ({
      id: `jp-${i}`,
      name,
      kind: CategoryKind.EXPENSE,
    }));
    const other = jp.find((c) => c.name === "その他")!;
    expect(
      resolveSuggestedCategoryId({
        pfcPrimary: "FOOD_AND_DRINK",
        kind: CategoryKind.EXPENSE,
        userCategories: jp,
        userBudgetNames: [],
        itemDefaultCategoryId: null,
        fallbackCategoryId: "fallback",
      }),
    ).toBe(other.id);
  });
});
