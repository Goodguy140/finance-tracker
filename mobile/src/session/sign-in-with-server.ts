import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { fetchWithTimeout } from '@/api/client';
import type { StoredSession } from '@/session/store';
import { parseServerAddress } from '@/utils/server-address';
import {
  authorizeUrl,
  describeTokenError,
  pkceChallenge,
  pkceVerifier,
  readRedirect,
  readServerInfo,
  readTokenResponse,
  REDIRECT_URI,
  tokenRequestBody,
} from '@/utils/sign-in';

export type SignInOutcome =
  | { status: 'signed-in'; session: StoredSession; displayName: string }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

/**
 * The whole sign-in: check the address is a Finance Tracker server, open its sign-in page in
 * the system sheet (a private one, so it shares no cookies with Safari and the person signs in
 * fresh), and trade the code it hands back for this phone's token.
 */
export async function signInWithServer(address: string): Promise<SignInOutcome> {
  const parsed = parseServerAddress(address);
  if (!parsed.ok) return { status: 'failed', error: parsed.error };
  const { origin } = parsed;

  let info;
  try {
    const res = await fetchWithTimeout(`${origin}/api/v1/server`, { headers: { accept: 'application/json' } });
    info = res.ok ? readServerInfo(await res.json().catch(() => null)) : null;
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  if (!info) {
    return {
      status: 'failed',
      error: "That address isn't a Finance Tracker server, or its version is too old for the app. Update the server and try again.",
    };
  }

  const verifier = pkceVerifier(Crypto.getRandomBytes(32));
  const challenge = pkceChallenge(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  const state = pkceVerifier(Crypto.getRandomBytes(32));
  const deviceName = Device.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Phone');

  const result = await WebBrowser.openAuthSessionAsync(
    authorizeUrl(origin, info, { challenge, state, deviceName }),
    REDIRECT_URI,
    { preferEphemeralSession: true },
  );
  if (result.type !== 'success') return { status: 'cancelled' };
  const redirect = readRedirect(result.url, state);
  if (!redirect.ok) {
    return redirect.reason === 'denied'
      ? { status: 'cancelled' }
      : { status: 'failed', error: 'The sign-in did not complete. Try again.' };
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${origin}${info.tokenPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: tokenRequestBody({
        code: redirect.code,
        verifier,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? null,
      }),
    });
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  const body: unknown = await res.json().catch(() => null);
  const token = res.ok ? readTokenResponse(body) : null;
  if (!token) return { status: 'failed', error: describeTokenError(res.status, body) };

  return {
    status: 'signed-in',
    session: { origin, token: token.token, deviceId: token.deviceId },
    displayName: token.displayName,
  };
}

/** Ends this phone's token on the server. Best effort: the phone forgets it either way. */
export async function revokeOnServer(session: StoredSession): Promise<void> {
  try {
    await fetchWithTimeout(`${session.origin}/api/v1/app/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
    });
  } catch {
    // Offline or the server is down: the token still idles out on the server after 90 days,
    // and it can be signed out from Settings → Security there.
  }
}
