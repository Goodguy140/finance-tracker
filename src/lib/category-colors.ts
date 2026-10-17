/**
 * One colour per category, shared by everything that draws one: the Spending by category pie,
 * and the dots on Expense Log and Income rows. A category is the same colour wherever it is.
 */

export const CATEGORY_PALETTE = [
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#2dd4bf",
  "#818cf8",
  "#f472b6",
  "#a3e635",
  "#fb923c",
  "#22d3ee",
  "#e879f9",
] as const;

/** For a category the map does not know (deleted since load) and the pie's rolled-up tail. */
export const NEUTRAL_CATEGORY_COLOR = "#64748b";

/**
 * The Spending by category pie's optional Savings slice. Savings is not a category, so it sits
 * outside the palette: no category can ever share its colour.
 */
export const SAVINGS_SLICE_COLOR = "#059669";

export type CategoryColors = Readonly<Record<string, string>>;

function hashIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % CATEGORY_PALETTE.length;
}

/**
 * Each category starts at a colour picked from its id and, if an older category already has
 * that colour, takes the next free one. Oldest first, so adding a category never recolours an
 * existing one, and deleting one only moves those that had stepped aside for it. Past twelve
 * categories the palette is reused.
 */
export function assignCategoryColors(
  categories: readonly { id: string; createdAt: Date }[],
): CategoryColors {
  const ordered = [...categories].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const colors: Record<string, string> = {};
  let taken = new Set<number>();
  for (const { id } of ordered) {
    if (taken.size === CATEGORY_PALETTE.length) taken = new Set();
    let index = hashIndex(id);
    while (taken.has(index)) index = (index + 1) % CATEGORY_PALETTE.length;
    taken.add(index);
    colors[id] = CATEGORY_PALETTE[index];
  }
  return colors;
}

export function categoryColor(colors: CategoryColors, categoryId: string): string {
  return colors[categoryId] ?? NEUTRAL_CATEGORY_COLOR;
}
