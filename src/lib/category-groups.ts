/**
 * Category groups: an optional heading a category is filed under (`Category.groupName`), so
 * Groceries and Restaurants can add up under Food. A group is only a label shared by name —
 * there is no group table — so renaming one means renaming it on each member, and a group with
 * no members simply stops existing.
 */

export const MAX_GROUP_NAME_LENGTH = 40;

/** Trimmed, single-spaced, or null for "not grouped". Throws on a name that is too long. */
export function normalizeGroupName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    throw new Error(`Group names can be at most ${MAX_GROUP_NAME_LENGTH} characters.`);
  }
  return name;
}

export type CategoryGroupSection<T> = {
  /** Null for the categories not in any group, listed last. */
  groupName: string | null;
  items: T[];
};

/**
 * Splits items into their groups, groups alphabetically and the ungrouped last, each keeping
 * the order the items came in. Group names match ignoring case, shown as first seen.
 */
export function sectionByGroup<T>(items: readonly T[], groupOf: (item: T) => string | null | undefined): CategoryGroupSection<T>[] {
  const groups = new Map<string, CategoryGroupSection<T>>();
  const ungrouped: T[] = [];
  for (const item of items) {
    const name = groupOf(item);
    if (!name) {
      ungrouped.push(item);
      continue;
    }
    const key = name.toLowerCase();
    const section = groups.get(key) ?? { groupName: name, items: [] };
    section.items.push(item);
    groups.set(key, section);
  }
  const sections = [...groups.values()].sort((a, b) => a.groupName!.localeCompare(b.groupName!));
  if (ungrouped.length > 0) sections.push({ groupName: null, items: ungrouped });
  return sections;
}

/** Whether any item is in a group: views keep their flat layout until the user makes one. */
export function hasGroups<T>(items: readonly T[], groupOf: (item: T) => string | null | undefined): boolean {
  return items.some((item) => Boolean(groupOf(item)));
}

/**
 * Adds up spending per group for a chart: each group becomes one entry named after it, with the
 * colour of its biggest member so it stays recognisable; ungrouped categories pass through.
 * Entries must come sorted biggest first, as the pie's slices do, and are returned that way.
 */
export function mergeSlicesByGroup<T extends { name: string; cents: number; color: string }>(
  slices: readonly (T & { groupName: string | null })[],
): Array<{ name: string; cents: number; color: string; categoryCount: number }> {
  const merged = new Map<string, { name: string; cents: number; color: string; categoryCount: number }>();
  for (const slice of slices) {
    const key = slice.groupName ? `g:${slice.groupName.toLowerCase()}` : `c:${slice.name}`;
    const entry = merged.get(key);
    if (entry) {
      entry.cents += slice.cents;
      entry.categoryCount += 1;
    } else {
      merged.set(key, { name: slice.groupName ?? slice.name, cents: slice.cents, color: slice.color, categoryCount: 1 });
    }
  }
  return [...merged.values()].filter((s) => s.cents !== 0).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
}

export type GroupYearRow = {
  groupName: string;
  categoryNames: string[];
  currentCents: number;
  previousCents: number;
  changeRatio: number | null;
};

/**
 * Reports' year-over-year rows added up per group, biggest this period first. Categories not in
 * a group are left out: they are each their own row in the table this sits beside.
 */
export function groupYearRows(
  rows: readonly { categoryId: string; categoryName: string; currentCents: number; previousCents: number }[],
  groupOf: ReadonlyMap<string, string | null>,
): GroupYearRow[] {
  const groups = sectionByGroup(rows, (row) => groupOf.get(row.categoryId) ?? null).filter(
    (section): section is CategoryGroupSection<(typeof rows)[number]> & { groupName: string } => section.groupName !== null,
  );
  return groups
    .map((section) => {
      const currentCents = section.items.reduce((sum, r) => sum + r.currentCents, 0);
      const previousCents = section.items.reduce((sum, r) => sum + r.previousCents, 0);
      return {
        groupName: section.groupName,
        categoryNames: section.items.map((r) => r.categoryName),
        currentCents,
        previousCents,
        changeRatio: previousCents > 0 ? (currentCents - previousCents) / previousCents : null,
      };
    })
    .sort((a, b) => b.currentCents - a.currentCents || a.groupName.localeCompare(b.groupName));
}
