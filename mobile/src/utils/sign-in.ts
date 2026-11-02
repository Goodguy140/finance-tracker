import { base64UrlFromBase64, base64UrlFromBytes } from '@/utils/base64url';

/**
 * The phone side of the server's app sign-in (`src/lib/app-devices.ts` in the web app):
 * OAuth 2.0 for native apps with PKCE. Pure functions only, so they can be tested without a
 * phone; `src/session/sign-in-with-server.ts` wires them to the browser sheet and the network.
 */

/** Must match `APP_REDIRECT_URI` on the server and the `scheme` in app.json. */
export const REDIRECT_URI = 'financetracker://signed-in';

export type ServerInfo = { authorizePath: string; tokenPath: string; revokePath: string };

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

/** `GET /api/v1/server`: null unless it is a Finance Tracker server this app can sign in to. */
export function readServerInfo(body: unknown): ServerInfo | null {
  if (!body || typeof body !== 'object') return null;
  const { service, api, appSignIn } = body as Record<string, unknown>;
  if (service !== 'finance-tracker' || api !== 1 || !appSignIn || typeof appSignIn !== 'object') return null;
  const { authorizePath, tokenPath, revokePath, redirectUri } = appSignIn as Record<string, unknown>;
  if (!isPath(authorizePath) || !isPath(tokenPath) || !isPath(revokePath) || redirectUri !== REDIRECT_URI) {
    return null;
  }
  return { authorizePath, tokenPath, revokePath };
}

/** A PKCE verifier from 32 random bytes: 43 characters, all from the unreserved set. */
export function pkceVerifier(randomBytes: Uint8Array): string {
  if (randomBytes.length < 32) throw new Error('A PKCE verifier needs at least 32 random bytes.');
  return base64UrlFromBytes(randomBytes);
}

/** S256: base64url of the SHA-256 of the verifier, from the digest as standard base64. */
export function pkceChallenge(sha256Base64: string): string {
  return base64UrlFromBase64(sha256Base64);
}

export function authorizeUrl(
  origin: string,
  info: ServerInfo,
  params: { challenge: string; state: string; deviceName: string },
): string {
  const query = new URLSearchParams({
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    state: params.state,
    device: params.deviceName,
    redirect_uri: REDIRECT_URI,
  });
  return `${origin}${info.authorizePath}?${query.toString()}`;
}

export type RedirectResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'denied' | 'invalid' };

/**
 * The address the sign-in sheet closed on. `state` must be the one this sign-in sent, or the
 * code could be from a sign-in someone else started; such a code is ignored.
 */
export function readRedirect(url: string, expectedState: string): RedirectResult {
  if (!url.startsWith(`${REDIRECT_URI}?`)) return { ok: false, reason: 'invalid' };
  const params = new URLSearchParams(url.slice(REDIRECT_URI.length + 1));
  if (params.get('state') !== expectedState) return { ok: false, reason: 'invalid' };
  if (params.get('error') === 'access_denied') return { ok: false, reason: 'denied' };
  const code = params.get('code');
  return code ? { ok: true, code } : { ok: false, reason: 'invalid' };
}

export function tokenRequestBody(input: { code: string; verifier: string; platform: string; appVersion: string | null }): string {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: REDIRECT_URI,
    platform: input.platform,
  });
  if (input.appVersion) body.set('app_version', input.appVersion);
  return body.toString();
}

export type TokenResponse = { token: string; deviceId: string; displayName: string; email: string };

/** `POST /api/v1/app/token`'s answer, or null when it is not a device token. */
export function readTokenResponse(body: unknown): TokenResponse | null {
  if (!body || typeof body !== 'object') return null;
  const { access_token: token, token_type: type, device, user } = body as Record<string, unknown>;
  if (typeof token !== 'string' || !token.startsWith('ftd_') || type !== 'Bearer') return null;
  const deviceId = (device as { id?: unknown } | undefined)?.id;
  const { displayName, email } = (user ?? {}) as { displayName?: unknown; email?: unknown };
  if (typeof deviceId !== 'string' || typeof displayName !== 'string' || typeof email !== 'string') return null;
  return { token, deviceId, displayName, email };
}

/** The server's `error_description` when it sent one, else a fallback for the status. */
export function describeTokenError(status: number, body: unknown): string {
  const description = (body as { error_description?: unknown } | null)?.error_description;
  if (typeof description === 'string' && description) return description;
  if (status === 429) return 'Too many sign-in attempts. Wait a minute and try again.';
  return 'The server did not accept the sign-in. Try again.';
}
