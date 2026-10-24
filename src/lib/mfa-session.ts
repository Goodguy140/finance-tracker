import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { MFA_STEP_UP_MAX_AGE_MS, SESSION_MAX_AGE_S } from "@/lib/auth-constants";

/**
 * Passkey verification state for the current login.
 *
 * Sessions are stateless NextAuth JWTs that the app cannot rewrite after issue (App Router
 * `getServerSession` discards cookie updates), so "this login has passed its passkey check"
 * lives in a second, HMAC-signed cookie instead. The cookie is bound to the user id AND to
 * the `sid` claim stamped into the JWT at sign-in: a fresh login always gets a new `sid`,
 * so it always needs a fresh passkey assertion, and a cookie lifted from one session is
 * useless with another.
 *
 * Passwordless sign-in is the one case verified before any session exists; there the JWT
 * itself carries an `mfa` claim set at sign-in (inherently bound), and `getMfaState` accepts
 * either source.
 */

export type MfaMethod = "passkey" | "recovery" | "enroll";

export type MfaCookiePayload = {
  sub: string;
  sid: string;
  verifiedAt: number;
  method: MfaMethod;
};

export type MfaState = {
  verified: boolean;
  verifiedAt: number | null;
  method: MfaMethod | "passkey-signin" | null;
};

export { MFA_STEP_UP_MAX_AGE_MS };

export const MFA_COOKIE_MAX_AGE_S = SESSION_MAX_AGE_S;

/** Placeholder `sid` for tokens issued before the claim existed (they age out in 7 days). */
export const LEGACY_SID = "legacy";

type SignedPurpose = "mfa" | "sso-link" | "reauth";

function getSecret(explicit?: string): string {
  const secret = explicit ?? process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing required env var NEXTAUTH_SECRET in production.");
    }
    return "dev-only-nextauth-secret-change-me";
  }
  return secret;
}

/** Distinct key per purpose so an MFA cookie can never be replayed as a link intent. */
function derivedKey(purpose: SignedPurpose, secret?: string): Buffer {
  return createHash("sha256").update(`${purpose}-cookie:${getSecret(secret)}`).digest();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signPayload(purpose: SignedPurpose, payload: object, secret?: string): string {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac("sha256", derivedKey(purpose, secret)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readSignedPayload<T extends object>(
  purpose: SignedPurpose,
  raw: string | undefined,
  secret?: string,
): T | null {
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", derivedKey(purpose, secret)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function signMfaPayload(payload: MfaCookiePayload, secret?: string): string {
  return signPayload("mfa", payload, secret);
}

/**
 * Returns the payload only if it is authentic, bound to this user + login, and not older
 * than a session can be. `now`/`secret` are injectable for tests.
 */
export function verifyMfaPayload(
  raw: string | undefined,
  opts: { sub: string; sid: string; now?: number; secret?: string },
): MfaCookiePayload | null {
  const payload = readSignedPayload<Partial<MfaCookiePayload>>("mfa", raw, opts.secret);
  if (!payload) return null;
  const { sub, sid, verifiedAt, method } = payload;
  if (typeof sub !== "string" || typeof sid !== "string" || typeof verifiedAt !== "number") return null;
  if (method !== "passkey" && method !== "recovery" && method !== "enroll") return null;
  if (sub !== opts.sub || sid !== opts.sid) return null;
  const now = opts.now ?? Date.now();
  if (verifiedAt > now + 60_000) return null;
  if (now - verifiedAt > MFA_COOKIE_MAX_AGE_S * 1000) return null;
  return { sub, sid, verifiedAt, method };
}

/** Same rule NextAuth's `getToken` uses to decide between plain and `__Secure-` names. */
export function mfaCookieSecure(): boolean {
  return Boolean(process.env.NEXTAUTH_URL?.trim().startsWith("https://"));
}

export function mfaCookieName(): string {
  return mfaCookieSecure() ? "__Host-mfa" : "mfa";
}

export function ssoLinkCookieName(): string {
  return mfaCookieSecure() ? "__Host-sso-link" : "sso-link";
}

export function sessionSid(session: Session): string {
  return session.user?.sid ?? LEGACY_SID;
}

export async function getMfaState(session: Session): Promise<MfaState> {
  const userId = session.user?.id;
  if (!userId) return { verified: false, verifiedAt: null, method: null };

  const store = await cookies();
  const cookie = verifyMfaPayload(store.get(mfaCookieName())?.value, {
    sub: userId,
    sid: sessionSid(session),
  });
  const claim = session.user?.mfa;

  // Prefer whichever verification is more recent: the cookie is refreshed on every step-up,
  // while the sign-in claim is fixed for the life of the token.
  if (cookie && (!claim || cookie.verifiedAt >= claim.at)) {
    return { verified: true, verifiedAt: cookie.verifiedAt, method: cookie.method };
  }
  if (claim && typeof claim.at === "number") {
    return { verified: true, verifiedAt: claim.at, method: "passkey-signin" };
  }
  return { verified: false, verifiedAt: null, method: null };
}

export async function setMfaVerifiedCookie(params: { userId: string; sid: string; method: MfaMethod }) {
  const store = await cookies();
  const payload: MfaCookiePayload = {
    sub: params.userId,
    sid: params.sid,
    verifiedAt: Date.now(),
    method: params.method,
  };
  store.set(mfaCookieName(), signMfaPayload(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: mfaCookieSecure(),
    path: "/",
    maxAge: MFA_COOKIE_MAX_AGE_S,
  });
}

export async function clearMfaCookie() {
  const store = await cookies();
  store.set(mfaCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: mfaCookieSecure(),
    path: "/",
    maxAge: 0,
  });
}

/** Short-lived intent that authorises `linkOAuthUser` to attach a provider to `userId`. */
export type SsoLinkIntent = { userId: string; provider: string; challengeId: string; exp: number };

export const SSO_LINK_MAX_AGE_S = 10 * 60;

export async function setSsoLinkCookie(intent: SsoLinkIntent) {
  const store = await cookies();
  store.set(ssoLinkCookieName(), signPayload("sso-link", intent), {
    httpOnly: true,
    sameSite: "lax",
    secure: mfaCookieSecure(),
    path: "/",
    maxAge: SSO_LINK_MAX_AGE_S,
  });
}

export function readSsoLinkIntent(raw: string | undefined, now = Date.now(), secret?: string): SsoLinkIntent | null {
  const intent = readSignedPayload<Partial<SsoLinkIntent>>("sso-link", raw, secret);
  if (!intent) return null;
  const { userId, provider, challengeId, exp } = intent;
  if (typeof userId !== "string" || typeof provider !== "string" || typeof challengeId !== "string") return null;
  if (typeof exp !== "number" || exp <= now) return null;
  return { userId, provider, challengeId, exp };
}

export async function clearSsoLinkCookie() {
  const store = await cookies();
  store.set(ssoLinkCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: mfaCookieSecure(),
    path: "/",
    maxAge: 0,
  });
}

/**
 * "Confirmed it's you" by re-entering the password, for accounts with no passkey. Bound to
 * the login's `sid` like the passkey cookie, and only honoured for a few minutes (see
 * `src/lib/recent-identity.ts`), so it never outlives the step-up window it exists for.
 */
export type ReauthPayload = { sub: string; sid: string; at: number };

export function reauthCookieName(): string {
  return mfaCookieSecure() ? "__Host-reauth" : "reauth";
}

/** When the password was re-entered, if the cookie is authentic and belongs to this login. */
export function verifyReauthPayload(
  raw: string | undefined,
  opts: { sub: string; sid: string; now?: number; secret?: string },
): number | null {
  const payload = readSignedPayload<Partial<ReauthPayload>>("reauth", raw, opts.secret);
  if (!payload) return null;
  const { sub, sid, at } = payload;
  if (sub !== opts.sub || sid !== opts.sid || typeof at !== "number") return null;
  if (at > (opts.now ?? Date.now()) + 60_000) return null;
  return at;
}

export async function readReauthAt(params: { userId: string; sid: string }): Promise<number | null> {
  const store = await cookies();
  return verifyReauthPayload(store.get(reauthCookieName())?.value, { sub: params.userId, sid: params.sid });
}

export async function setReauthCookie(params: { userId: string; sid: string }) {
  const store = await cookies();
  const payload: ReauthPayload = { sub: params.userId, sid: params.sid, at: Date.now() };
  store.set(reauthCookieName(), signPayload("reauth", payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: mfaCookieSecure(),
    path: "/",
    maxAge: Math.ceil(MFA_STEP_UP_MAX_AGE_MS / 1000),
  });
}
