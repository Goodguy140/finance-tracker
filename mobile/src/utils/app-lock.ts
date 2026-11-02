/** How long the app may sit in the background before it asks again. */
export const RELOCK_AFTER_MS = 5 * 60_000;

/** Whether coming back to the front should lock: the app was away at least `RELOCK_AFTER_MS`. */
export function shouldRelock(backgroundedAt: number | null, now: number): boolean {
  return backgroundedAt !== null && now - backgroundedAt >= RELOCK_AFTER_MS;
}

/** What iOS will ask for, by name: Face ID, Touch ID, or the passcode on a phone with neither set up. */
export function lockMethodName(supports: { face: boolean; fingerprint: boolean }): string {
  if (supports.face) return 'Face ID';
  if (supports.fingerprint) return 'Touch ID';
  return 'Passcode';
}
