import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { fetchWithTimeout } from '@/api/client';
import { signChallengeWithPasskey } from '@/session/passkeys';
import type { StoredSession } from '@/session/store';
import { base64FromBase64Url } from '@/utils/base64url';
import { isHomeServer } from '@/utils/home-server';
import { passkeyTokenRequestBody, readPasskeyOptions, readPasskeySignIn } from '@/utils/passkey-sign-in';
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
 * The server this build was made for (`HOME_SERVER_DOMAIN`, app.config.ts), or null in a build
 * made without one. Face ID sign-in works with this server only (`src/utils/home-server.ts`).
 */
export const HOME_SERVER: string | null = (() => {
  const value: unknown = Constants.expoConfig?.extra?.homeServerDomain;
  return typeof value === 'string' && value ? value : null;
})();

const NOT_A_SERVER =
  "That address isn't a Finance Tracker server, or its version is too old for the app. Update the server and try again.";

function deviceName(): string {
  return Device.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Phone');
}

/** `GET /api/v1/server`, as JSON, or null when the server did not answer with any. */
async function fetchServerInfo(origin: string): Promise<unknown> {
  const res = await fetchWithTimeout(`${origin}/api/v1/server`, { headers: { accept: 'application/json' } });
  return res.ok ? res.json().catch(() => null) : null;
}

async function readSignedIn(origin: string, res: Response): Promise<SignInOutcome> {
  const body: unknown = await res.json().catch(() => null);
  const token = res.ok ? readTokenResponse(body) : null;
  if (!token) return { status: 'failed', error: describeTokenError(res.status, body) };
  return {
    status: 'signed-in',
    session: { origin, token: token.token, deviceId: token.deviceId },
    displayName: token.displayName,
  };
}

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
    info = readServerInfo(await fetchServerInfo(origin));
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  if (!info) return { status: 'failed', error: NOT_A_SERVER };

  const verifier = pkceVerifier(Crypto.getRandomBytes(32));
  const challenge = pkceChallenge(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  const state = pkceVerifier(Crypto.getRandomBytes(32));

  const result = await WebBrowser.openAuthSessionAsync(
    authorizeUrl(origin, info, { challenge, state, deviceName: deviceName() }),
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
  return readSignedIn(origin, res);
}

/**
 * Face ID sign-in, with the home server only: a challenge from the server, iOS's passkey sheet
 * to sign it, and the signature traded for this phone's token. Nothing opens in a browser.
 */
export async function signInWithPasskey(address: string): Promise<SignInOutcome> {
  const parsed = parseServerAddress(address);
  if (!parsed.ok) return { status: 'failed', error: parsed.error };
  const { origin } = parsed;
  if (!isHomeServer(origin, HOME_SERVER)) {
    return { status: 'failed', error: 'Face ID sign-in works only with the server this app was built for. Use Continue to sign in.' };
  }

  try {
    const body = await fetchServerInfo(origin);
    if (!readServerInfo(body)) return { status: 'failed', error: NOT_A_SERVER };
    const passkey = readPasskeySignIn(body);
    if (!passkey || passkey.rpId !== HOME_SERVER) {
      return {
        status: 'failed',
        error: "This server isn't set up for Face ID sign-in yet. Use Continue to sign in on its web page.",
      };
    }

    const optionsRes = await fetchWithTimeout(`${origin}${passkey.optionsPath}`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    const optionsBody: unknown = await optionsRes.json().catch(() => null);
    const options = optionsRes.ok ? readPasskeyOptions(optionsBody) : null;
    if (!options || options.rpId !== passkey.rpId) {
      return { status: 'failed', error: describeTokenError(optionsRes.status, optionsBody) };
    }

    const signed = await signChallengeWithPasskey(options.rpId, base64FromBase64Url(options.challenge));
    if (signed.status === 'cancelled') return { status: 'cancelled' };
    if (signed.status === 'failed') {
      return { status: 'failed', error: `Face ID sign-in didn't work: ${signed.error} You can still sign in with Continue.` };
    }

    const res = await fetchWithTimeout(`${origin}${passkey.tokenPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: passkeyTokenRequestBody({
        challengeId: options.challengeId,
        assertion: signed.assertion,
        deviceName: deviceName(),
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? null,
      }),
    });
    return await readSignedIn(origin, res);
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
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
