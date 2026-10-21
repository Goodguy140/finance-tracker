/**
 * How large a backup file the restore accepts.
 *
 * Restore is a Server Action, and Next refuses any action body over 1 MB unless told
 * otherwise. A backup is roughly 800 bytes per transaction, so the default turned away
 * anything past about 1,300 transactions: a file the app had just exported for that same
 * account could not be put back. `next.config.ts` raises both the action limit and the
 * proxy's body buffer (which truncates past its own 10 MB default) to `BACKUP_REQUEST_LIMIT`.
 *
 * No imports: `next.config.ts` and the client form read this too.
 */
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

/** The file plus multipart framing; Next counts the raw request body. */
export const BACKUP_REQUEST_LIMIT_BYTES = BACKUP_MAX_BYTES + 1024 * 1024;

export function backupTooLargeMessage(bytes: number): string {
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return `This backup is ${mb(bytes)} MB, and restore accepts files up to ${mb(BACKUP_MAX_BYTES)} MB.`;
}
