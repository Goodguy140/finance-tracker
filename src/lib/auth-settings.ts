/** ServerSetting key for the SSO-only switch. */
export const PASSWORD_LOGIN_DISABLED_KEY = "auth.passwordLoginDisabled";

/**
 * Env override for the SSO-only switch, mirroring how `AUTHENTIK_ENABLED` behaves: an unset
 * or blank value defers to the database, `"false"`/`"0"` force password login back on, and
 * anything else present turns it off. Returns null when the env has no opinion.
 *
 * The env exists as the way back in: if SSO breaks and the admin cannot reach the settings
 * page to flip the row, `DISABLE_PASSWORD_LOGIN=false` on the container restores password
 * login without touching the database.
 */
export function resolvePasswordLoginDisabledEnv(
  raw = process.env.DISABLE_PASSWORD_LOGIN,
): boolean | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  return !(value === "false" || value === "0");
}

export type SsoOnlyPrecondition = {
  hasOAuthProvider: boolean;
  /** Whether the admin turning this on has an SSO identity already linked to their account. */
  actorHasLinkedProvider: boolean;
};

/**
 * Why enabling SSO-only must be refused, or null when it is safe.
 *
 * Turning password login off without a working identity provider — or without the acting
 * admin having proved their own SSO account works by linking it — locks everyone out of a
 * self-hosted app with no support desk behind it. Pure so both conditions are testable.
 */
export function describeSsoOnlyRefusal(pre: SsoOnlyPrecondition): string | null {
  if (!pre.hasOAuthProvider) {
    return "Configure and enable Google or Authentik before disabling password login.";
  }
  if (!pre.actorHasLinkedProvider) {
    return "Link your own account to an SSO provider first, or you will be locked out.";
  }
  return null;
}
