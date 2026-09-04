/**
 * How long an issued session stays valid (seconds). Lives outside `auth-options.ts` so the
 * MFA cookie module can share it without importing NextAuth config (which imports it back).
 */
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

/**
 * How recent a passkey assertion must be to count as step-up for linking anything
 * external. Shared with the client so it can skip a prompt it knows the server would skip.
 */
export const MFA_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;
