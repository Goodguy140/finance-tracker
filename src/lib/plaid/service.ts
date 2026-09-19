import type { PlaidItem } from "@prisma/client";
import { createPlaidClient, PlaidApiError, type PlaidClient } from "@/lib/plaid/client";
import { getPlaidConfig } from "@/lib/plaid/config";
import type { PlaidEnvironment } from "@/lib/plaid/settings";
import { encryptSecret, tryDecryptSecret } from "@/lib/security";

/**
 * The impure half of the Plaid integration: resolving a configured client, and the two
 * places a stored access token is turned back into a usable credential.
 *
 * Kept apart from `client.ts` (which knows nothing about this app) and from the actions
 * (which should not be handling ciphertext), so there is exactly one place to look for
 * "where does a decrypted Plaid token come from".
 */

export class PlaidNotConfiguredError extends Error {
  constructor() {
    super(
      "Plaid is not set up on this server. An administrator can configure it under Settings → Server admin → Plaid.",
    );
    this.name = "PlaidNotConfiguredError";
  }
}

export class PlaidCredentialUnreadableError extends Error {
  constructor() {
    super(
      "This bank connection's stored credentials could not be read, which usually means SERVER_SETTINGS_ENCRYPTION_KEY was rotated. Unlink the bank and connect it again.",
    );
    this.name = "PlaidCredentialUnreadableError";
  }
}

/**
 * Whether the deterministic in-memory Plaid may stand in for the real one.
 *
 * Two conditions, both required. `PLAID_FAKE_CLIENT=1` is the explicit opt-in, and the
 * resolved environment must be `sandbox`.
 *
 * The environment check is the one doing the real work. Keying this on `NODE_ENV` would
 * be no protection at all here: the end-to-end suite runs an actual production build (see
 * scripts/e2e-server.cjs), so `NODE_ENV` is "production" in exactly the place the fake is
 * needed. What actually matters is that a deployment pointed at *production Plaid* — real
 * banks, real money, real billing — can never be silently swapped for a fixture by an
 * environment variable. A sandbox deployment has no real data to misrepresent.
 */
export function plaidFakeClientAllowed(
  environment: PlaidEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PLAID_FAKE_CLIENT === "1" && environment === "sandbox";
}

/** For the UI, which needs to know before it has a config in hand. */
export async function plaidFakeClientEnabled(): Promise<boolean> {
  const config = await getPlaidConfig();
  return config !== null && plaidFakeClientAllowed(config.environment);
}

/** The configured client, or a typed refusal. Never returns a half-configured client. */
export async function requirePlaidClient(): Promise<PlaidClient> {
  const config = await getPlaidConfig();
  if (!config) throw new PlaidNotConfiguredError();
  if (plaidFakeClientAllowed(config.environment)) {
    const { createFakePlaidClient } = await import("@/lib/plaid/fake-client");
    return createFakePlaidClient();
  }
  return createPlaidClient(config);
}

export async function plaidConfigured(): Promise<boolean> {
  return (await getPlaidConfig()) !== null;
}

/** Encrypts an access token for storage. The plaintext must never be persisted or logged. */
export function sealAccessToken(accessToken: string): string {
  return encryptSecret(accessToken);
}

/**
 * Decrypts a stored access token.
 *
 * Throws rather than returning null: every caller needs the token to do anything at all,
 * and a rotated encryption key should surface as one clear "relink this bank" message
 * instead of a null that each call site invents its own handling for.
 */
export function openAccessToken(item: Pick<PlaidItem, "accessTokenEnc">): string {
  const token = tryDecryptSecret(item.accessTokenEnc);
  if (!token) throw new PlaidCredentialUnreadableError();
  return token;
}

/**
 * Revokes one item at Plaid, for `revokePlaidItemsForUser`.
 *
 * Treats an item Plaid has already forgotten as success: the goal is that the connection
 * no longer exists, and refusing to clean up locally because it is *already* gone would
 * leave rows nothing can remove. A token that cannot be decrypted is also treated as
 * revocable-by-deletion — there is no way to call Plaid with it, and blocking forever on
 * a key rotation would make the account undeletable.
 */
export function makePlaidItemRevoker(client: PlaidClient) {
  return async (item: { id: string; itemId: string; accessTokenEnc: string }): Promise<void> => {
    const accessToken = tryDecryptSecret(item.accessTokenEnc);
    if (!accessToken) return;
    try {
      await client.removeItem(accessToken);
    } catch (err) {
      if (err instanceof PlaidApiError && err.itemAlreadyGone) return;
      throw err;
    }
  };
}

/**
 * A revoker when Plaid is configured, or null when it is not.
 *
 * Null is deliberately *not* a no-op revoker: `revokePlaidItemsForUser` refuses when it
 * has no revoker and items exist, which is the correct outcome. If Plaid has been turned
 * off at the server level while a user still has linked banks, those banks are still live
 * at Plaid and deleting the rows would strand them.
 */
export async function tryMakePlaidItemRevoker() {
  const config = await getPlaidConfig();
  if (!config) return null;
  // Through `requirePlaidClient` rather than `createPlaidClient` so the deletion paths
  // honour the fake client too — otherwise an end-to-end account deletion would reach
  // the real Plaid while every other call in the same run did not.
  return makePlaidItemRevoker(await requirePlaidClient());
}
