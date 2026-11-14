import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';

import { SignedOutError } from '@/api/client';
import { confirmWithFaceId, postAsApp as post } from '@/session/step-up';
import type { StoredSession } from '@/session/store';
import { readLinkFinish, readLinkStart, type LinkFinish, type UpdateKind } from '@/utils/banks';

/** Storing a new bank waits on Plaid and the bank, so this allows longer than an ordinary call. */
const LINK_TIMEOUT_MS = 90_000;

export type BankLinkRequest = { mode: 'create'; historyDays: number } | { mode: 'update'; plaidItemId: string; updateKind: UpdateKind };

export type BankLinkOutcome =
  | { status: 'done'; result: LinkFinish }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

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
