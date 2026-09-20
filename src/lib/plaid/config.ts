import { prisma } from "@/lib/prisma";
import { tryDecryptSecret } from "@/lib/security";
import {
  PLAID_SETTING_KEYS,
  buildPlaidAdminStatus,
  envCredentialsComplete,
  normalizePlaidEnvironment,
  type PlaidAdminStatus,
  type PlaidEnvironment,
} from "@/lib/plaid/settings";

export type PlaidConfig = {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
};

/**
 * Resolved Plaid credentials, memoised per process and keyed on a cheap signature of the
 * `plaid.*` rows (count + newest `updatedAt`), exactly as `oauth-provider-config.ts` does
 * for providers. A sync sweep would otherwise read and decrypt four rows per item per
 * hour; an edit made in the admin UI, by another instance, or straight in the database
 * still shows up on the next call at the cost of one aggregate query.
 */
type CachedPlaidConfig = { signature: string; config: PlaidConfig | null; enabled: boolean };

let configCache: CachedPlaidConfig | null = null;
let configCacheInFlight: Promise<CachedPlaidConfig> | null = null;

export function invalidatePlaidConfigCache() {
  configCache = null;
  configCacheInFlight = null;
}

function envVars() {
  return {
    clientId: process.env.PLAID_CLIENT_ID?.trim() ?? "",
    secret: process.env.PLAID_SECRET?.trim() ?? "",
    env: process.env.PLAID_ENV?.trim() ?? "",
  };
}

async function plaidSettingsSignature(): Promise<string> {
  const agg = await prisma.serverSetting.aggregate({
    where: { key: { startsWith: "plaid." } },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
}

/** Reads one `plaid.*` row. Returns "" for both "absent" and "could not be decrypted". */
async function readSetting(key: string): Promise<string> {
  const row = await prisma.serverSetting.findUnique({ where: { key } });
  if (!row) return "";
  return tryDecryptSecret(row.encryptedValue) ?? "";
}

async function resolvePlaidConfig(): Promise<{ config: PlaidConfig | null; enabled: boolean }> {
  const env = envVars();
  const [enabledRaw, storedClientId, storedSecret, storedEnv] = await Promise.all([
    readSetting(PLAID_SETTING_KEYS.enabled),
    readSetting(PLAID_SETTING_KEYS.clientId),
    readSetting(PLAID_SETTING_KEYS.secret),
    readSetting(PLAID_SETTING_KEYS.env),
  ]);

  // The env pair wins outright when both halves are set, mirroring how Authentik env
  // credentials override the stored ones. `plaid.enabled` still gates the feature either
  // way, so an operator can leave credentials in the environment and turn Plaid off.
  if (envCredentialsComplete(env)) {
    return {
      enabled: enabledRaw.trim() === "true",
      config: {
        clientId: env.clientId,
        secret: env.secret,
        environment: normalizePlaidEnvironment(env.env),
      },
    };
  }

  if (!storedClientId || !storedSecret) return { config: null, enabled: enabledRaw.trim() === "true" };
  return {
    enabled: enabledRaw.trim() === "true",
    config: {
      clientId: storedClientId,
      secret: storedSecret,
      environment: normalizePlaidEnvironment(storedEnv),
    },
  };
}

async function getCachedPlaidConfig(): Promise<CachedPlaidConfig> {
  const signature = await plaidSettingsSignature();
  if (configCache && configCache.signature === signature) return configCache;
  if (!configCacheInFlight) {
    configCacheInFlight = resolvePlaidConfig()
      .then(({ config, enabled }) => {
        configCache = { signature, config, enabled };
        return configCache;
      })
      .finally(() => {
        configCacheInFlight = null;
      });
  }
  return configCacheInFlight;
}

/** Credentials to call Plaid with, or null when Plaid is off or not configured. */
export async function getPlaidConfig(): Promise<PlaidConfig | null> {
  const cached = await getCachedPlaidConfig();
  return cached.enabled ? cached.config : null;
}

/** Everything the admin page renders, including which source is actually in play. */
export async function getPlaidAdminStatus(): Promise<PlaidAdminStatus & { storedClientId: string }> {
  const env = envVars();
  const keys = [PLAID_SETTING_KEYS.clientId, PLAID_SETTING_KEYS.secret, PLAID_SETTING_KEYS.env];
  const rows = await prisma.serverSetting.findMany({ where: { key: { in: [...keys, PLAID_SETTING_KEYS.enabled] } } });
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const decryptFailedKeys: string[] = [];
  const read = (key: string): string => {
    const row = byKey.get(key);
    if (!row) return "";
    const value = tryDecryptSecret(row.encryptedValue);
    if (value === null) {
      decryptFailedKeys.push(key);
      return "";
    }
    return value;
  };

  const enabled = read(PLAID_SETTING_KEYS.enabled);
  const clientId = read(PLAID_SETTING_KEYS.clientId);
  const secret = read(PLAID_SETTING_KEYS.secret);
  const storedEnv = read(PLAID_SETTING_KEYS.env);

  const status = buildPlaidAdminStatus({
    enabled,
    clientId,
    secret,
    env: storedEnv,
    decryptFailedKeys,
    envVars: env,
  });
  // Safe to echo back into the form: a client id is not a secret, and the form needs it to
  // render without the operator retyping it. The secret is never returned.
  return { ...status, storedClientId: clientId };
}
