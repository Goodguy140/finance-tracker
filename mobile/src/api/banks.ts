import { errorFromResponse, fetchWithTimeout } from '@/api/client';
import type { StoredSession } from '@/session/store';

/** Checking a bank waits on the bank itself, so this allows far longer than an ordinary call. */
const REFRESH_TIMEOUT_MS = 90_000;

export type BankRefresh = { tone: 'success' | 'neutral' | 'warning'; message: string };

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
  // A bank that could not be reached is a 502 carrying Plaid's own words, which say more than
  // the generic text a gateway error gets.
  if (res.status === 502) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) throw new Error(body.error);
  }
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as BankRefresh;
}
