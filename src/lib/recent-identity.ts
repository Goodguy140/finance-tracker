import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import { readReauthAt } from "@/lib/mfa-session";
import { requireLoadedUser, type LoadedSession } from "@/lib/session";

/**
 * "Confirm it's you" before an action a stolen session cookie must not be able to take on
 * its own: deleting the account, wiping or replacing its data, and the server-admin
 * controls (roles, suspensions, sign-in providers, bank credentials, public sign-up).
 *
 * How depends on what the account has, strongest first:
 * - a passkey or authenticator app: a fresh use of it (the same step-up as linking a bank or
 *   minting a token);
 * - a password: re-entering it;
 * - neither (SSO only): the login itself must be recent, so the user signs in again.
 * Any of them counts for `MFA_STEP_UP_MAX_AGE_MS`, so several changes in a row need one prompt.
 */

export type IdentityMethod = "mfa" | "password" | "sso";

/** The second factors an account has, so the client offers the right prompt. */
export type MfaFactors = { passkey: boolean; totp: boolean };

/** What the client needs to prompt only when the server would refuse. */
export type IdentityPrompt = { method: IdentityMethod; freshUntil: number | null; factors: MfaFactors };

export const IDENTITY_REQUIRED_MESSAGE = "Confirm it's you, then try again.";

export class IdentityConfirmationRequiredError extends Error {
  constructor() {
    super(IDENTITY_REQUIRED_MESSAGE);
    this.name = "IdentityConfirmationRequiredError";
  }
}

export function identityMethodFor(loaded: Pick<LoadedSession, "mfa"> & { user: { passwordHash: string | null } }): IdentityMethod {
  if (loaded.mfa.required) return "mfa";
  return loaded.user.passwordHash ? "password" : "sso";
}

/**
 * When this login last proved who it is, by the method its account requires. An account with
 * a second factor only counts that factor: re-entering a password must not stand in for the
 * stronger factor the owner chose. The others count the sign-in itself as well as a re-entered password.
 */
export function identityConfirmedAt(input: {
  method: IdentityMethod;
  mfaVerifiedAt: number | null;
  authAt: number | null;
  reauthAt: number | null;
}): number | null {
  if (input.method === "mfa") return input.mfaVerifiedAt;
  const candidates = [input.authAt, input.method === "password" ? input.reauthAt : null].filter(
    (at): at is number => typeof at === "number",
  );
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

export function identityFreshUntil(confirmedAt: number | null): number | null {
  return confirmedAt == null ? null : confirmedAt + MFA_STEP_UP_MAX_AGE_MS;
}

async function confirmedAtFor(loaded: LoadedSession): Promise<number | null> {
  const method = identityMethodFor(loaded);
  return identityConfirmedAt({
    method,
    mfaVerifiedAt: loaded.mfa.verified ? loaded.mfa.verifiedAt : null,
    authAt: loaded.authAt,
    reauthAt: method === "password" ? await readReauthAt({ userId: loaded.user.id, sid: loaded.sid }) : null,
  });
}

export async function identityPromptFor(loaded: LoadedSession): Promise<IdentityPrompt> {
  return {
    method: identityMethodFor(loaded),
    freshUntil: identityFreshUntil(await confirmedAtFor(loaded)),
    factors: { passkey: loaded.mfa.passkeyCount > 0, totp: loaded.mfa.totp },
  };
}

/** `requireUser`, plus a recent "it's you". Throws `IdentityConfirmationRequiredError` otherwise. */
export async function requireRecentIdentity(now = Date.now()): Promise<LoadedSession> {
  const loaded = await requireLoadedUser();
  const freshUntil = identityFreshUntil(await confirmedAtFor(loaded));
  if (freshUntil == null || now > freshUntil) throw new IdentityConfirmationRequiredError();
  return loaded;
}
