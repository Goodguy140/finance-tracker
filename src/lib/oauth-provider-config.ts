import { AuthentikProvider } from "@/lib/authentik-provider";
import { PASSWORD_LOGIN_DISABLED_KEY, resolvePasswordLoginDisabledEnv } from "@/lib/auth-settings";
import { normalizeAuthentikIssuer } from "@/lib/oauth-settings";
import { getServerSetting } from "@/lib/server-settings";
import { prisma } from "@/lib/prisma";
import GoogleProvider from "next-auth/providers/google";
import type { Provider } from "next-auth/providers/index";

/**
 * Provider construction reads and decrypts up to seven ServerSetting rows, and
 * `getAuthOptions` runs it on every request that loads a session (including anonymous
 * health checks). The resolved pair is memoised per process and keyed on a cheap
 * signature of the `oauth.*` rows (their count and newest `updatedAt`), so an edit made
 * through the admin UI, by another instance, or straight in the database shows up on the
 * next request at the cost of one small aggregate query instead of seven reads plus
 * decryption. Env-based Authentik config is static for the life of the process.
 */
type CachedProviders = {
  signature: string;
  google: Provider | null;
  authentik: Provider | null;
  passwordLoginDisabled: boolean;
};
let providerCache: CachedProviders | null = null;
let providerCacheInFlight: Promise<CachedProviders> | null = null;

export function invalidateOAuthProviderCache() {
  providerCache = null;
  providerCacheInFlight = null;
}

async function oauthSettingsSignature(): Promise<string> {
  // `auth.` is included because the SSO-only switch is resolved alongside the providers and
  // shares this cache; `startsWith` is anchored, so it does not also match `oauth.`.
  const agg = await prisma.serverSetting.aggregate({
    where: { OR: [{ key: { startsWith: "oauth." } }, { key: { startsWith: "auth." } }] },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
}

async function getCachedOAuthProviders(): Promise<CachedProviders> {
  const signature = await oauthSettingsSignature();
  if (providerCache && providerCache.signature === signature) return providerCache;
  if (!providerCacheInFlight) {
    providerCacheInFlight = Promise.all([
      resolveGoogleProvider(),
      resolveAuthentikProvider(),
      resolvePasswordLoginDisabled(),
    ])
      .then(([google, authentik, passwordLoginDisabled]) => {
        providerCache = { signature, google, authentik, passwordLoginDisabled };
        return providerCache;
      })
      .finally(() => {
        providerCacheInFlight = null;
      });
  }
  return providerCacheInFlight;
}

export async function getGoogleProvider(): Promise<Provider | null> {
  return (await getCachedOAuthProviders()).google;
}

export async function getAuthentikProvider(): Promise<Provider | null> {
  return (await getCachedOAuthProviders()).authentik;
}

/** True when password sign-in is turned off and only SSO or a passkey may be used. */
export async function isPasswordLoginDisabled(): Promise<boolean> {
  return (await getCachedOAuthProviders()).passwordLoginDisabled;
}

async function resolvePasswordLoginDisabled(): Promise<boolean> {
  const fromEnv = resolvePasswordLoginDisabledEnv();
  if (fromEnv !== null) return fromEnv;
  return (await getServerSetting(PASSWORD_LOGIN_DISABLED_KEY)) === "true";
}

async function resolveGoogleProvider(): Promise<Provider | null> {
  const [enabled, clientId, clientSecret] = await Promise.all([
    getServerSetting("oauth.google.enabled"),
    getServerSetting("oauth.google.clientId"),
    getServerSetting("oauth.google.clientSecret"),
  ]);
  if (enabled !== "true" || !clientId || !clientSecret) return null;
  return GoogleProvider({ clientId, clientSecret });
}

async function resolveAuthentikProvider(): Promise<Provider | null> {
  const envIssuer = process.env.AUTHENTIK_ISSUER?.trim();
  const envClientId = process.env.AUTHENTIK_CLIENT_ID?.trim();
  const envClientSecret = process.env.AUTHENTIK_CLIENT_SECRET?.trim();
  const envEnabled = process.env.AUTHENTIK_ENABLED?.trim().toLowerCase();

  if (envIssuer && envClientId && envClientSecret) {
    if (envEnabled === "false" || envEnabled === "0") return null;
    return AuthentikProvider({
      issuer: normalizeAuthentikIssuer(envIssuer),
      clientId: envClientId,
      clientSecret: envClientSecret,
    });
  }

  const [enabled, issuer, clientId, clientSecret] = await Promise.all([
    getServerSetting("oauth.authentik.enabled"),
    getServerSetting("oauth.authentik.issuer"),
    getServerSetting("oauth.authentik.clientId"),
    getServerSetting("oauth.authentik.clientSecret"),
  ]);

  if (enabled !== "true" || !issuer || !clientId || !clientSecret) return null;
  return AuthentikProvider({
    issuer: normalizeAuthentikIssuer(issuer),
    clientId,
    clientSecret,
  });
}
