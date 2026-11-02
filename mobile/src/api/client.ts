import type { StoredSession } from '@/session/store';

/** The server no longer accepts this phone's token: signed out elsewhere, idle, or revoked. */
export class SignedOutError extends Error {
  constructor() {
    super('This phone was signed out. Sign in again.');
    this.name = 'SignedOutError';
  }
}

const TIMEOUT_MS = 15_000;

/** `fetch` that gives up after `TIMEOUT_MS`, so a server that never answers does not hang a screen. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new Error("The server didn't answer. Check the address and your connection.");
    throw new Error("Couldn't reach the server. Check the address and your connection.", { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/** GET a `/api/v1` route as this phone. Throws `SignedOutError` on 401. */
export async function apiGet<T>(session: StoredSession, path: string): Promise<T> {
  const res = await fetchWithTimeout(`${session.origin}${path}`, {
    headers: { authorization: `Bearer ${session.token}`, accept: 'application/json' },
  });
  if (res.status === 401) throw new SignedOutError();
  if (!res.ok) throw new Error(`The server answered ${res.status}. Try again shortly.`);
  return (await res.json()) as T;
}

export type Me = {
  user: { id: string; email: string; displayName: string; timezone: string; countryCode: string; currency: string };
  device: { id: string };
};

export type BudgetRow = {
  categoryId: string;
  categoryName: string;
  limitCents: number;
  spentCents: number;
  percentUsed: number;
};

export type Budgets = {
  periodMonth: string;
  currency: string;
  budgets: BudgetRow[];
  totalLimitCents: number;
  totalSpentCents: number;
};
