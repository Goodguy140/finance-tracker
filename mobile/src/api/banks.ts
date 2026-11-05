import { errorFromResponse, fetchWithTimeout } from '@/api/client';
import type { StoredSession } from '@/session/store';

/** Checking a bank waits on the bank itself, so this allows far longer than an ordinary call. */
const REFRESH_TIMEOUT_MS = 90_000;

export type BankRefresh = { tone: 'success' | 'neutral' | 'warning'; message: string };

/** One bank's Sync Now: what came in, and whether it now wants the person to sign in again. */
export type BankSync = BankRefresh & { staged: number; needsSignIn: boolean };

/** A 502 carries Plaid's own words, which say more than the generic text a gateway error gets. */
async function bankError(res: Response): Promise<Error> {
  if (res.status === 502) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) return new Error(body.error);
  }
  return errorFromResponse(res);
}

/**
 * Asks the server to check this person's banks now (`POST /api/v1/banks/refresh`), as the
 * refresh icon on the website's transaction log does. What it finds waits in the review queue.
 */
export async function refreshBanks(session: StoredSession): Promise<BankRefresh> {
  const res = await fetchWithTimeout(
    `${session.origin}/api/v1/banks/refresh`,
    { method: 'POST', headers: { authorization: `Bearer ${session.token}`, accept: 'application/json' } },
    REFRESH_TIMEOUT_MS,
  );
  if (!res.ok) throw await bankError(res);
  return (await res.json()) as BankRefresh;
}

/**
 * Syncs one bank now (`POST /api/v1/banks/:id/sync`), as the website's Sync now does: whatever
 * the server's schedule, and whether or not the background sweep is on.
 */
export async function syncOneBank(session: StoredSession, bankId: string): Promise<BankSync> {
  const res = await fetchWithTimeout(
    `${session.origin}/api/v1/banks/${encodeURIComponent(bankId)}/sync`,
    { method: 'POST', headers: { authorization: `Bearer ${session.token}`, accept: 'application/json' } },
    REFRESH_TIMEOUT_MS,
  );
  if (!res.ok) throw await bankError(res);
  return (await res.json()) as BankSync;
}
