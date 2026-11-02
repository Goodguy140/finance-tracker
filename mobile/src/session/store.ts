import * as SecureStore from 'expo-secure-store';

/** What a signed-in phone keeps: which server, and the device token it was given. */
export type StoredSession = { origin: string; token: string; deviceId: string };

const SESSION_KEY = 'session';
const LAST_SERVER_KEY = 'lastServer';

/**
 * The Keychain, readable only while the phone is unlocked and never copied to another device
 * through a backup: a restored backup starts signed out rather than carrying the token across.
 */
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const { origin, token, deviceId } = value as Record<string, unknown>;
  return typeof origin === 'string' && typeof token === 'string' && typeof deviceId === 'string';
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, KEYCHAIN);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), KEYCHAIN);
  // Not a secret; only so the next sign-in starts with the address filled in.
  await SecureStore.setItemAsync(LAST_SERVER_KEY, session.origin, KEYCHAIN);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, KEYCHAIN);
}

export async function loadLastServer(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_SERVER_KEY, KEYCHAIN);
}
