import { fetchWithTimeout, SignedOutError } from '@/api/client';
import { signChallengeWithPasskey } from '@/session/passkeys';
import type { StoredSession } from '@/session/store';
import { base64FromBase64Url } from '@/utils/base64url';
import { authenticationResponse, readPasskeyOptions } from '@/utils/passkey-sign-in';

/**
 * POSTs JSON as this phone. Every answer these routes give in `{ error }` is written for the
 * person, including a 502 carrying Plaid's own words, so it is shown whatever the status.
 */
export async function postAsApp(session: StoredSession, path: string, body: unknown, timeoutMs?: number): Promise<unknown> {
  const res = await fetchWithTimeout(
    `${session.origin}${path}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (res.status === 401) throw new SignedOutError();
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (json as { error?: unknown } | null)?.error;
    throw new Error(typeof error === 'string' && error ? error : `The server answered ${res.status}. Try again shortly.`);
  }
  return json;
}

export type Confirmed = { status: 'confirmed'; stepUp: { challengeId: string; response: ReturnType<typeof authenticationResponse> } };

/**
 * "Confirm it's you", as the website asks before connecting a bank or adding a passkey: Face ID
 * with one of this account's passkeys, signing a challenge from `POST /api/v1/app/step-up/options`.
 */
export async function confirmWithFaceId(session: StoredSession): Promise<Confirmed | { status: 'cancelled' } | { status: 'failed'; error: string }> {
  const options = readPasskeyOptions(await postAsApp(session, '/api/v1/app/step-up/options', {}));
  if (!options) return { status: 'failed', error: 'The server did not start Face ID. Try again.' };
  const signed = await signChallengeWithPasskey(options.rpId, base64FromBase64Url(options.challenge));
  if (signed.status === 'cancelled') return { status: 'cancelled' };
  if (signed.status === 'failed') {
    return { status: 'failed', error: `Face ID did not confirm it was you: ${signed.error}` };
  }
  return { status: 'confirmed', stepUp: { challengeId: options.challengeId, response: authenticationResponse(signed.assertion) } };
}
