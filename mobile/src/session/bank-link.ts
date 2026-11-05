import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';

import { fetchWithTimeout, SignedOutError } from '@/api/client';
import { signChallengeWithPasskey } from '@/session/passkeys';
import type { StoredSession } from '@/session/store';
import { base64FromBase64Url } from '@/utils/base64url';
import { readLinkFinish, readLinkStart, type LinkFinish, type UpdateKind } from '@/utils/banks';
import { authenticationResponse, readPasskeyOptions } from '@/utils/passkey-sign-in';

/** Storing a new bank waits on Plaid and the bank, so this allows longer than an ordinary call. */
const LINK_TIMEOUT_MS = 90_000;

export type BankLinkRequest = { mode: 'create'; historyDays: number } | { mode: 'update'; plaidItemId: string; updateKind: UpdateKind };

export type BankLinkOutcome =
  | { status: 'done'; result: LinkFinish }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

/**
 * POSTs JSON as this phone. Every answer these routes give in `{ error }` is written for the
 * person, including a 502 carrying Plaid's own words, so it is shown whatever the status.
 */
async function post(session: StoredSession, path: string, body: unknown, timeoutMs?: number): Promise<unknown> {
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

type Confirmed = { status: 'confirmed'; stepUp: { challengeId: string; response: ReturnType<typeof authenticationResponse> } };

/** "Confirm it's you", as the website asks before a bank connection: Face ID with this account's passkey. */
async function confirmWithFaceId(session: StoredSession): Promise<Confirmed | { status: 'cancelled' } | { status: 'failed'; error: string }> {
  const options = readPasskeyOptions(await post(session, '/api/v1/app/step-up/options', {}));
  if (!options) return { status: 'failed', error: 'The server did not start Face ID. Try again.' };
  const signed = await signChallengeWithPasskey(options.rpId, base64FromBase64Url(options.challenge));
  if (signed.status === 'cancelled') return { status: 'cancelled' };
  if (signed.status === 'failed') {
    return { status: 'failed', error: `Face ID did not confirm it was you: ${signed.error}` };
  }
  return { status: 'confirmed', stepUp: { challengeId: options.challengeId, response: authenticationResponse(signed.assertion) } };
}

type LinkResult = { status: 'success'; publicToken: string } | { status: 'exit'; error: string | null };

/** Plaid Link, full screen, until the person finishes or leaves it. */
function openPlaidLink(token: string): Promise<LinkResult> {
  return new Promise((resolve, reject) => {
    createPlaidLinkSession({
      token,
      onSuccess: (success) => resolve({ status: 'success', publicToken: success.publicToken }),
      onExit: (exit) => resolve({ status: 'exit', error: exit.error?.displayMessage || exit.error?.errorMessage || null }),
      onEvent: () => {},
    })
      .then((link) => link.open(true))
      .catch(reject);
  });
}

/**
 * Connects a new bank, or fixes one, from start to finish: Face ID, then the server opens a Plaid
 * Link session for this phone, then Link, then the server stores what Link returned. A fix
 * sends no token back: the connection already has one, and the server re-reads it.
 */
export async function runBankLink(session: StoredSession, request: BankLinkRequest): Promise<BankLinkOutcome> {
  try {
    const confirmed = await confirmWithFaceId(session);
    if (confirmed.status !== 'confirmed') return confirmed;

    const start = readLinkStart(await post(session, '/api/v1/banks/link', { ...request, stepUp: confirmed.stepUp }));
    if (!start) return { status: 'failed', error: 'The server did not open Plaid. Try again.' };

    const link = await openPlaidLink(start.linkToken);
    if (link.status === 'exit') return link.error ? { status: 'failed', error: link.error } : { status: 'cancelled' };

    const finished = readLinkFinish(
      await post(
        session,
        `/api/v1/banks/link/${encodeURIComponent(start.linkId)}/complete`,
        request.mode === 'create' ? { publicToken: link.publicToken } : {},
        LINK_TIMEOUT_MS,
      ),
    );
    if (!finished) return { status: 'failed', error: 'The server did not say whether the bank was saved. Pull down to check.' };
    return { status: 'done', result: finished };
  } catch (err) {
    if (err instanceof SignedOutError) throw err;
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
