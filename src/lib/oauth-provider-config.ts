import { AuthentikProvider } from "@/lib/authentik-provider";
import { normalizeAuthentikIssuer } from "@/lib/oauth-settings";
import { tryDecryptSecret } from "@/lib/security";
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
type CachedProviders = { signature: string; google: Provider | null; authentik: Provider | null };
let providerCache: CachedProviders | null = null;
let providerCacheInFlight: Promise<CachedProviders> | null = null;

export function invalidateOAuthProviderCache() {
  providerCache = null;
  providerCacheInFlight = null;
}

async function oauthSettingsSignature(): Promise<string> {
  const agg = await prisma.serverSetting.aggregate({
    where: { key: { startsWith: "oauth." } },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
}

async function getCachedOAuthProviders(): Promise<CachedProviders> {
  const signature = await oauthSettingsSignature();
  if (providerCache && providerCache.signature === signature) return providerCache;
  if (!providerCacheInFlight) {
    providerCacheInFlight = Promise.all([resolveGoogleProvider(), resolveAuthentikProvider()])
      .then(([google, authentik]) => {
        providerCache = { signature, google, authentik };
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

async function getServerSetting(key: string) {
  const row = await prisma.serverSetting.findUnique({ where: { key } });
  if (!row) return null;
  return tryDecryptSecret(row.encryptedValue);
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
