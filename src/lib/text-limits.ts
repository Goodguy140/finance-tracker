/**
 * How long the free text on a transaction may be, in one place.
 *
 * Every way an entry gets in (the Add form, CSV and OFX import, the bank queue, the API and
 * quick add, a rule that adds a note) has to keep to these, because a backup is restored
 * through `userBackupSchema`, which holds the same limits. A row saved longer than the
 * restore check allows made the whole backup file unrestorable.
 */
export const TRANSACTION_TITLE_MAX = 120;
export const TRANSACTION_NOTE_MAX = 250;
/** Category names, the most an import may create one with (CSV category column). */
export const CATEGORY_NAME_MAX = 80;

/**
 * Text cut to `max` characters for paths that take what another system sends (a statement
 * line, a bank's merchant name) rather than refusing it. Trims first, so the limit is spent
 * on content; empty comes back as undefined.
 */
export function clipText(value: string | null | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}
