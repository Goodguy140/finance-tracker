/**
 * When a financial account is removed, keep a readable label on the transaction
 * (stored in `accountDescription`) without losing existing import memo text.
 */
export function mergeAccountDescriptionOnDetach(
  existing: string | null | undefined,
  removedAccountLabel: string,
): string {
  const trimmed = existing?.trim();
  if (!trimmed) return removedAccountLabel;
  return `${trimmed} · ${removedAccountLabel}`;
}
