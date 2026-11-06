import { categoryColor, NEUTRAL_CATEGORY_COLOR, type CategoryColors } from "@/lib/category-colors";

/**
 * The Spending by category pie's slices, shared by the dashboard card and the phone app
 * (`GET /api/v1/spending`) so both draw the same wedges in the same colours.
 */

export type CategoryPieSlice = {
  categoryId: string;
  name: string;
  cents: number;
  /** The category's colour from assignCategoryColors, so the slice matches its log dots. */
  color: string;
  groupName: string | null;
};

/**
 * One slice per category with net spending, biggest first by size (a refund-heavy category is
 * drawn by its absolute amount, as the pie sizes it). A category missing from `categories`
 * (deleted since) is named "Unknown" and drawn grey.
 */
export function buildCategoryPieSlices(
  spendByCategory: ReadonlyMap<string, number>,
  categories: readonly { id: string; name: string; groupName: string | null }[],
  colors: CategoryColors,
): CategoryPieSlice[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return Array.from(spendByCategory.entries())
    .map(([categoryId, cents]) => {
      const category = byId.get(categoryId);
      return {
        categoryId,
        name: category?.name ?? "Unknown",
        cents,
        color: categoryColor(colors, categoryId),
        groupName: category?.groupName ?? null,
      };
    })
    .filter((slice) => slice.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
}

/** The wedge the tail of small categories is rolled into. */
export const OTHER_CATEGORIES_NAME = "Other categories";

/**
 * Keep the biggest categories and roll the tail into one wedge. A pie with twenty slivers
 * says less than one with eight and a remainder, and the card can be as narrow as a phone.
 * Pinned slices (Savings, which is not a category) are never rolled in and stay last.
 */
export function collapseToMaxSlices<T extends { name: string; cents: number; color: string; pinned?: boolean }>(
  slices: readonly T[],
  maxSlices: number | undefined,
): Array<T | { name: string; cents: number; color: string; other: true }> {
  const pinned = slices.filter((slice) => slice.pinned);
  const categories = slices.filter((slice) => !slice.pinned);
  if (!maxSlices || categories.length <= maxSlices) return [...slices];
  const ranked = [...categories].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const kept = ranked.slice(0, maxSlices - 1);
  const restCents = ranked.slice(maxSlices - 1).reduce((sum, slice) => sum + slice.cents, 0);
  const collapsed =
    restCents === 0 ? kept : [...kept, { name: OTHER_CATEGORIES_NAME, cents: restCents, color: NEUTRAL_CATEGORY_COLOR, other: true as const }];
  return [...collapsed, ...pinned];
}
