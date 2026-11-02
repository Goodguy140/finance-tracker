import type { StoredSession } from '@/session/store';

/** The server no longer accepts this phone's token: signed out elsewhere, idle, or revoked. */
export class SignedOutError extends Error {
  constructor() {
    super('This phone was signed out. Sign in again.');
    this.name = 'SignedOutError';
  }
}

/** The server answered, but said no: `message` is its own `{ error }` text when it sent one. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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

/** The error to show for a response that is not OK: the server's own words for a 4xx, a retry hint otherwise. */
export async function errorFromResponse(res: Response): Promise<Error> {
  if (res.status === 401) return new SignedOutError();
  let message: string | null = null;
  if (res.status < 500) {
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error) message = body.error;
    } catch {
      // Not JSON: fall through to the generic text.
    }
  }
  return new ApiError(res.status, message ?? `The server answered ${res.status}. Try again shortly.`);
}

/** Calls a `/api/v1` route as this phone. Throws `SignedOutError` on 401 and `ApiError` on any other failure. */
export async function apiRequest<T>(
  session: StoredSession,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetchWithTimeout(`${session.origin}${path}`, {
    method,
    headers: {
      ...extraHeaders,
      authorization: `Bearer ${session.token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(session: StoredSession, path: string): Promise<T> {
  return apiRequest<T>(session, 'GET', path);
}
