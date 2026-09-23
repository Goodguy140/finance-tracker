import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { tryDecryptSecret } from "@/lib/security";

/**
 * Operational settings an admin can change without a redeploy: who may sign up, how long
 * the audit log is kept, how often banks are swept, and whether recurring rules post on
 * their own.
 *
 * Each used to be an env var only. They still are — an env var that is set always wins,
 * as it does for OAuth and Plaid credentials, so an operator who pinned a value in their
 * compose file keeps it. The database value applies only when the env var is absent (or,
 * for the numbers, unparseable, which the env-only code already treated as absent).
 */

export const OPS_SETTING_KEYS = {
  publicSignup: "auth.publicSignup",
  auditRetentionDays: "ops.auditRetentionDays",
  plaidSyncIntervalMinutes: "ops.plaidSyncIntervalMinutes",
  recurringAutoPost: "ops.recurringAutoPost",
} as const;

export const OPS_SETTING_ENV = {
  publicSignup: "ALLOW_PUBLIC_SIGNUP",
  auditRetentionDays: "AUDIT_LOG_RETENTION_DAYS",
  plaidSyncIntervalMinutes: "PLAID_SYNC_INTERVAL_MINUTES",
  recurringAutoPost: "RECURRING_AUTO_POST_SCHEDULER",
} as const;

export type OpsSettingSource = "environment" | "database" | "default";

export type ResolvedSetting<T> = {
  value: T;
  source: OpsSettingSource;
  envName: string;
  /** What is saved in the database, whether or not it is the value in effect. */
  stored: T | null;
};

export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
/** What the admin form accepts. The env var keeps accepting any positive integer. */
export const AUDIT_RETENTION_MIN_DAYS = 30;
export const AUDIT_RETENTION_MAX_DAYS = 3650;

export const DEFAULT_PLAID_SYNC_INTERVAL_MINUTES = 60;
/**
 * Below this, a sweep stops being a background refresh and starts being a way to burn
 * through Plaid's rate limits on an account that sees a handful of transactions a day.
 */
export const MIN_PLAID_SYNC_INTERVAL_MINUTES = 15;
export const MAX_PLAID_SYNC_INTERVAL_MINUTES = 24 * 60;

type Raw = string | undefined | null;

function trimmed(raw: Raw): string {
  return raw?.trim() ?? "";
}

function parseBool(raw: Raw): boolean | null {
  const value = trimmed(raw).toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

function parsePositiveInt(raw: Raw, min = 1): number | null {
  // parseInt, not a strict pattern: this is how the env-only code read these, and an
  // operator's existing value must keep meaning what it meant.
  const n = Number.parseInt(trimmed(raw), 10);
  return Number.isFinite(n) && n >= min ? n : null;
}

/**
 * `ALLOW_PUBLIC_SIGNUP`, when set to anything, decides outright: `true`/`1` opens signup and
 * every other value closes it, exactly as before. Unset, the stored switch decides; with
 * neither, signup is open in development and closed in production.
 */
export function resolvePublicSignup(input: {
  envRaw: Raw;
  storedRaw: Raw;
  nodeEnv?: string;
}): ResolvedSetting<boolean> {
  const envName = OPS_SETTING_ENV.publicSignup;
  const stored = parseBool(input.storedRaw);
  if (input.envRaw !== undefined && input.envRaw !== null) {
    return { value: parseBool(input.envRaw) === true, source: "environment", envName, stored };
  }
  if (stored !== null) return { value: stored, source: "database", envName, stored };
  return { value: input.nodeEnv !== "production", source: "default", envName, stored };
}

/**
 * Anything that is not a positive integer keeps the default. `0` is not accepted: an audit
 * log that deletes itself is no log.
 */
export function resolveAuditRetention(input: { envRaw: Raw; storedRaw: Raw }): ResolvedSetting<number> {
  const envName = OPS_SETTING_ENV.auditRetentionDays;
  const stored = parsePositiveInt(input.storedRaw);
  const fromEnv = parsePositiveInt(input.envRaw);
  if (fromEnv !== null) return { value: fromEnv, source: "environment", envName, stored };
  if (stored !== null) return { value: stored, source: "database", envName, stored };
  return { value: DEFAULT_AUDIT_RETENTION_DAYS, source: "default", envName, stored };
}

/**
 * Unparseable, zero, negative or below the floor falls back rather than being clamped up:
 * a value that was meant to say something and could not be honoured is better treated as
 * unset than silently reinterpreted.
 */
export function resolvePlaidSyncInterval(input: { envRaw: Raw; storedRaw: Raw }): ResolvedSetting<number> {
  const envName = OPS_SETTING_ENV.plaidSyncIntervalMinutes;
  const stored = parsePositiveInt(input.storedRaw, MIN_PLAID_SYNC_INTERVAL_MINUTES);
  const fromEnv = parsePositiveInt(input.envRaw, MIN_PLAID_SYNC_INTERVAL_MINUTES);
  if (fromEnv !== null) return { value: fromEnv, source: "environment", envName, stored };
  if (stored !== null) return { value: stored, source: "database", envName, stored };
  return { value: DEFAULT_PLAID_SYNC_INTERVAL_MINUTES, source: "default", envName, stored };
}

/**
 * Two switches, both of which must be on, the same arrangement as the Plaid sweep: the env
 * var can only force the scheduler off (and is read once at boot, since it cannot change
 * under a running process), while the stored switch is re-read every tick.
 */
export function resolveRecurringAutoPost(input: { envRaw: Raw; storedRaw: Raw }): ResolvedSetting<boolean> {
  const envName = OPS_SETTING_ENV.recurringAutoPost;
  const stored = parseBool(input.storedRaw);
  if (parseBool(input.envRaw) === false) return { value: false, source: "environment", envName, stored };
  if (stored !== null) return { value: stored, source: "database", envName, stored };
  return { value: true, source: "default", envName, stored };
}

export type OpsSettingsStatus = {
  publicSignup: ResolvedSetting<boolean>;
  auditRetentionDays: ResolvedSetting<number>;
  plaidSyncIntervalMinutes: ResolvedSetting<number>;
  recurringAutoPost: ResolvedSetting<boolean>;
};

export function resolveOpsSettings(
  stored: Partial<Record<keyof typeof OPS_SETTING_KEYS, string>>,
  env: Record<string, string | undefined> = process.env,
): OpsSettingsStatus {
  return {
    publicSignup: resolvePublicSignup({
      envRaw: env[OPS_SETTING_ENV.publicSignup],
      storedRaw: stored.publicSignup,
      nodeEnv: env.NODE_ENV,
    }),
    auditRetentionDays: resolveAuditRetention({
      envRaw: env[OPS_SETTING_ENV.auditRetentionDays],
      storedRaw: stored.auditRetentionDays,
    }),
    plaidSyncIntervalMinutes: resolvePlaidSyncInterval({
      envRaw: env[OPS_SETTING_ENV.plaidSyncIntervalMinutes],
      storedRaw: stored.plaidSyncIntervalMinutes,
    }),
    recurringAutoPost: resolveRecurringAutoPost({
      envRaw: env[OPS_SETTING_ENV.recurringAutoPost],
      storedRaw: stored.recurringAutoPost,
    }),
  };
}

/**
 * Stored values, memoised per process and keyed on a cheap signature of the rows (count and
 * newest `updatedAt`), the same trick `plaid/config.ts` uses. Signup and the audit writer
 * run on hot paths — every sign-in writes an audit row — so a decrypt per call is not free,
 * but an edit made anywhere still shows up on the next call.
 */
type StoredOps = Partial<Record<keyof typeof OPS_SETTING_KEYS, string>>;
let storedCache: { signature: string; stored: StoredOps } | null = null;

const KEY_LIST = Object.values(OPS_SETTING_KEYS);

export function invalidateOpsSettingsCache() {
  storedCache = null;
}

async function storedSignature(prisma: PrismaClient): Promise<string> {
  const agg = await prisma.serverSetting.aggregate({
    where: { key: { in: KEY_LIST } },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
}

async function readStoredOps(prisma: PrismaClient): Promise<StoredOps> {
  const signature = await storedSignature(prisma);
  if (storedCache && storedCache.signature === signature) return storedCache.stored;
  const rows = await prisma.serverSetting.findMany({ where: { key: { in: KEY_LIST } } });
  const stored: StoredOps = {};
  for (const [name, key] of Object.entries(OPS_SETTING_KEYS) as [keyof typeof OPS_SETTING_KEYS, string][]) {
    const row = rows.find((r) => r.key === key);
    const value = row ? tryDecryptSecret(row.encryptedValue) : null;
    if (value !== null) stored[name] = value;
  }
  storedCache = { signature, stored };
  return stored;
}

export async function getOpsSettingsStatus(prisma: PrismaClient = defaultPrisma): Promise<OpsSettingsStatus> {
  return resolveOpsSettings(await readStoredOps(prisma));
}

export async function getPublicSignupAllowed(prisma: PrismaClient = defaultPrisma): Promise<boolean> {
  return (await getOpsSettingsStatus(prisma)).publicSignup.value;
}

export async function getAuditRetentionDays(prisma: PrismaClient = defaultPrisma): Promise<number> {
  return (await getOpsSettingsStatus(prisma)).auditRetentionDays.value;
}

export async function getPlaidSyncIntervalMinutes(prisma: PrismaClient = defaultPrisma): Promise<number> {
  return (await getOpsSettingsStatus(prisma)).plaidSyncIntervalMinutes.value;
}

export async function getRecurringAutoPostEnabled(prisma: PrismaClient = defaultPrisma): Promise<boolean> {
  return (await getOpsSettingsStatus(prisma)).recurringAutoPost.value;
}

/**
 * Form input for the retention days. Stricter than the env var on purpose: the env var
 * keeps its old any-positive-integer meaning, but a value typed into a form is checked
 * against a range that cannot quietly empty the log or keep it forever.
 */
export function parseAuditRetentionInput(raw: string): number {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) throw new Error("Audit retention must be a whole number of days.");
  const n = Number.parseInt(value, 10);
  if (n < AUDIT_RETENTION_MIN_DAYS || n > AUDIT_RETENTION_MAX_DAYS) {
    throw new Error(`Audit retention must be between ${AUDIT_RETENTION_MIN_DAYS} and ${AUDIT_RETENTION_MAX_DAYS} days.`);
  }
  return n;
}

export function parsePlaidSyncIntervalInput(raw: string): number {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) throw new Error("Sync interval must be a whole number of minutes.");
  const n = Number.parseInt(value, 10);
  if (n < MIN_PLAID_SYNC_INTERVAL_MINUTES || n > MAX_PLAID_SYNC_INTERVAL_MINUTES) {
    throw new Error(
      `Sync interval must be between ${MIN_PLAID_SYNC_INTERVAL_MINUTES} and ${MAX_PLAID_SYNC_INTERVAL_MINUTES} minutes.`,
    );
  }
  return n;
}
