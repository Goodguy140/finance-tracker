import { CategoryKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildPlaidMappingView } from "@/lib/plaid/category-mapping-view";
import { plaidCategoryLabel } from "@/lib/plaid/category-taxonomy";

const categories = [
  { id: "dining", name: "Dining", kind: CategoryKind.EXPENSE },
  { id: "groceries", name: "Groceries", kind: CategoryKind.EXPENSE },
  { id: "other", name: "Other", kind: CategoryKind.EXPENSE },
  { id: "salary", name: "Salary", kind: CategoryKind.INCOME },
];

describe("buildPlaidMappingView", () => {
  it("shows the built-in default where nothing is mapped, and the catch-all where it has no pick", () => {
    const view = buildPlaidMappingView({ categories, budgetNames: [], mappings: [] });
    const food = view.find((g) => g.code === "FOOD_AND_DRINK")!;
    expect(food.mappedCategoryId).toBeNull();
    expect(food.defaultLabel).toBe("Default: Dining");
    expect(food.detailed.find((d) => d.code === "FOOD_AND_DRINK_GROCERIES")!.defaultLabel).toBe(
      "Default: Dining",
    );
    expect(view.find((g) => g.code === "LOAN_PAYMENTS")!.defaultLabel).toBe("Default: Other");
    expect(view.find((g) => g.code === "INCOME")!.kind).toBe("INCOME");
  });

  it("shows the user's choices, and what a detailed code inherits from its primary", () => {
    const view = buildPlaidMappingView({
      categories,
      budgetNames: [],
      mappings: [
        { plaidCategory: "FOOD_AND_DRINK", categoryId: "groceries" },
        { plaidCategory: "FOOD_AND_DRINK_RESTAURANT", categoryId: "dining" },
        // Wrong kind: treated as unmapped, as the resolver treats it.
        { plaidCategory: "INCOME", categoryId: "dining" },
      ],
    });
    const food = view.find((g) => g.code === "FOOD_AND_DRINK")!;
    expect(food.mappedCategoryId).toBe("groceries");
    expect(food.detailed.find((d) => d.code === "FOOD_AND_DRINK_RESTAURANT")!.mappedCategoryId).toBe("dining");
    expect(food.detailed.find((d) => d.code === "FOOD_AND_DRINK_COFFEE")!.defaultLabel).toBe(
      "Default: Groceries",
    );
    expect(view.find((g) => g.code === "INCOME")!.mappedCategoryId).toBeNull();
  });

  it("never offers transfers, which have a category of their own", () => {
    const codes = buildPlaidMappingView({ categories, budgetNames: [], mappings: [] }).flatMap((g) => [
      g.code,
      ...g.detailed.map((d) => d.code),
    ]);
    expect(codes.some((code) => code.startsWith("TRANSFER_"))).toBe(false);
    expect(codes).not.toContain("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });
});

describe("plaidCategoryLabel", () => {
  it("reads codes as sentence-case labels", () => {
    expect(plaidCategoryLabel("FOOD_AND_DRINK")).toBe("Food and drink");
    expect(plaidCategoryLabel("FOOD_AND_DRINK_FAST_FOOD", "FOOD_AND_DRINK")).toBe("Fast food");
    expect(plaidCategoryLabel("BANK_FEES_ATM_FEES", "BANK_FEES")).toBe("ATM fees");
  });
});
