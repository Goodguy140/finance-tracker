import type { PrismaClient } from "@prisma/client";
import { parseApnsKey, type ApnsCredentials } from "@/lib/apns";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { tryDecryptSecret } from "@/lib/security";

/**
 * Apple push credentials for the iPhone app, kept encrypted in `ServerSetting` and set under
 * Settings → Server admin → Integrations (behind "Confirm it's you", like Plaid's). The `.p8`
 * key is never shown again once saved; a blank key field keeps the stored one.
 */

export const APNS_SETTING_KEYS = {
  key: "apns.key",
  keyId: "apns.keyId",
  teamId: "apns.teamId",
  bundleId: "apns.bundleId",
} as const;

/** The app's bundle ID as `mobile/app.json` sets it, offered until another is saved. */
export const DEFAULT_APNS_BUNDLE_ID = "com.goodguy140.financetracker";

const APPLE_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export type ApnsSettingsInput = {
  keyRaw: string;
  keyIdRaw: string;
  teamIdRaw: string;
  bundleIdRaw: string;
  existingKey: string;
};

/** What the admin form saves, checked; a blank key keeps `existingKey`. */
export function resolveApnsSettings(
  input: ApnsSettingsInput,
): { ok: true; values: ApnsCredentials; keyReplaced: boolean } | { ok: false; error: string } {
  const keyId = input.keyIdRaw.trim().toUpperCase();
  const teamId = input.teamIdRaw.trim().toUpperCase();
  const bundleId = input.bundleIdRaw.trim() || DEFAULT_APNS_BUNDLE_ID;
  const keyReplaced = input.keyRaw.trim() !== "";
  const key = keyReplaced ? input.keyRaw.trim() : input.existingKey;

  if (!APPLE_ID.test(keyId)) return { ok: false, error: "The key ID is the 10 letters and digits shown beside the key." };
  if (!APPLE_ID.test(teamId)) return { ok: false, error: "The team ID is 10 letters and digits (Membership details)." };
  if (!BUNDLE_ID.test(bundleId)) return { ok: false, error: "The bundle ID looks like com.example.app." };
  if (!key) return { ok: false, error: "Paste the .p8 key Apple gave you when you created it." };
  const parsed = parseApnsKey(key);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, values: { key, keyId, teamId, bundleId }, keyReplaced };
}

type Client = Pick<PrismaClient, "serverSetting">;

async function readSettings(client: Client) {
  const rows = await client.serverSetting.findMany({ where: { key: { in: Object.values(APNS_SETTING_KEYS) } } });
  const value = (key: string) => {
    const row = rows.find((r) => r.key === key);
    return row ? (tryDecryptSecret(row.encryptedValue) ?? "") : "";
  };
  return {
    key: value(APNS_SETTING_KEYS.key),
    keyId: value(APNS_SETTING_KEYS.keyId),
    teamId: value(APNS_SETTING_KEYS.teamId),
    bundleId: value(APNS_SETTING_KEYS.bundleId),
  };
}

/** The saved credentials, or null when the server cannot send to phones. Read per send: alerts are rare. */
export async function getApnsCredentials(client: Client = defaultPrisma): Promise<ApnsCredentials | null> {
  const stored = await readSettings(client);
  if (!stored.key || !stored.keyId || !stored.teamId || !stored.bundleId) return null;
  return stored;
}

/** What the admin form shows: everything but the key itself. */
export async function getApnsAdminStatus(client: Client = defaultPrisma) {
  const stored = await readSettings(client);
  return {
    configured: Boolean(stored.key && stored.keyId && stored.teamId && stored.bundleId),
    keySaved: Boolean(stored.key),
    keyId: stored.keyId,
    teamId: stored.teamId,
    bundleId: stored.bundleId || DEFAULT_APNS_BUNDLE_ID,
  };
}

/** The raw stored key, for "blank keeps it" when the admin form is saved. */
export async function getStoredApnsKey(client: Client = defaultPrisma): Promise<string> {
  return (await readSettings(client)).key;
}
