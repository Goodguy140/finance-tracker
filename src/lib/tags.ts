/**
 * Tags: per-user labels that cut across categories ("reimbursable", "tax deductible", a trip).
 * Pure and client-safe; the database side is `tags-server.ts`.
 */

export const MAX_TAG_NAME_LENGTH = 40;
/** Per transaction. A tag is a label, not a note: more than this is a sign of misuse. */
export const MAX_TAGS_PER_TRANSACTION = 10;

export type TagOption = { id: string; name: string };

/**
 * Trims, collapses inner whitespace and drops a leading "#" (people type them). Commas are
 * the separator in the form field, so a name cannot contain one. Empty when nothing is left.
 */
export function normalizeTagName(raw: string): string {
  return raw
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+\s*/, "")
    .slice(0, MAX_TAG_NAME_LENGTH)
    .trim();
}

/** What makes two names the same tag: "Trip" and "trip" are one. */
export function tagNameKey(name: string): string {
  return normalizeTagName(name).toLowerCase();
}

/**
 * Tag names from form values: each value may hold several, comma-separated. Keeps the first
 * spelling of each name and the order given. Throws past the per-transaction limit rather than
 * silently dropping tags the person typed.
 */
export function parseTagNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const name = normalizeTagName(part);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  if (names.length > MAX_TAGS_PER_TRANSACTION) {
    throw new Error(`A transaction can have up to ${MAX_TAGS_PER_TRANSACTION} tags.`);
  }
  return names;
}

/** The dashboard's `?tag=` filter: an id the user owns, or nothing. */
export function resolveTagFilter(raw: string | string[] | undefined, tags: readonly TagOption[]): TagOption | null {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) return null;
  return tags.find((tag) => tag.id === id) ?? null;
}
