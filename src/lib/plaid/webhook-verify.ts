import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import type { PlaidWebhookVerificationKey } from "@/lib/plaid/types";

/**
 * Checks that a webhook really came from Plaid, following Plaid's documented scheme.
 *
 * The endpoint is unauthenticated by necessity, and what it does — flip a bank connection
 * to "sign in again", clear that state — is exactly what a forger would want to toggle.
 * So nothing is acted on unless the `Plaid-Verification` header is an ES256 JWT, signed by
 * a key Plaid itself vouches for, issued within the last five minutes, over a SHA-256 of
 * these exact body bytes. Written against `node:crypto` directly: a JWT library would be a
 * dependency for about thirty lines.
 */

/** Plaid's own recommendation. Past this, a captured delivery can no longer be replayed. */
export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

export type WebhookKeyFetcher = (keyId: string) => Promise<PlaidWebhookVerificationKey>;

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: string };

type JwtHeader = { alg?: unknown; kid?: unknown };
type JwtPayload = { iat?: unknown; request_body_sha256?: unknown };

function decodeSegment<T>(segment: string): T | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/**
 * Keys by `kid`, per process. Plaid rotates rarely, and fetching on every delivery would
 * put a Plaid round trip in front of every webhook for no gain. A key cached after Plaid
 * marked it expired is fetched again, so a rotation is noticed.
 */
const keyCache = new Map<string, PlaidWebhookVerificationKey>();

export function clearWebhookKeyCache() {
  keyCache.clear();
}

async function resolveKey(
  keyId: string,
  fetchKey: WebhookKeyFetcher,
): Promise<PlaidWebhookVerificationKey | null> {
  const cached = keyCache.get(keyId);
  if (cached && cached.expired_at == null) return cached;
  try {
    const key = await fetchKey(keyId);
    keyCache.set(keyId, key);
    return key;
  } catch {
    return null;
  }
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase(), "utf8");
  const right = Buffer.from(b.toLowerCase(), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function verifyPlaidWebhook(input: {
  body: string;
  signedJwt: string | null;
  fetchKey: WebhookKeyFetcher;
  now?: Date;
}): Promise<WebhookVerification> {
  const token = input.signedJwt?.trim();
  if (!token) return { ok: false, reason: "missing Plaid-Verification header" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed JWT" };
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeSegment<JwtHeader>(headerSegment);
  // Checked before anything is fetched: an `alg` of "none" or an HMAC variant is the
  // classic JWT forgery, and must not get as far as a key lookup.
  if (!header || header.alg !== "ES256") return { ok: false, reason: "unexpected alg" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "missing kid" };

  const key = await resolveKey(header.kid, input.fetchKey);
  if (!key) return { ok: false, reason: "unknown key" };
  if (key.expired_at != null) return { ok: false, reason: "expired key" };

  let signatureOk = false;
  try {
    signatureOk = verify(
      "sha256",
      Buffer.from(`${headerSegment}.${payloadSegment}`),
      {
        key: createPublicKey({
          format: "jwk",
          key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
        }),
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(signatureSegment, "base64url"),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, reason: "bad signature" };

  const payload = decodeSegment<JwtPayload>(payloadSegment);
  if (!payload || typeof payload.iat !== "number") return { ok: false, reason: "missing iat" };
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (nowSeconds - payload.iat > WEBHOOK_MAX_AGE_SECONDS) return { ok: false, reason: "stale" };

  if (typeof payload.request_body_sha256 !== "string") {
    return { ok: false, reason: "missing body hash" };
  }
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  if (!sameHex(bodyHash, payload.request_body_sha256)) {
    return { ok: false, reason: "body hash mismatch" };
  }

  return { ok: true };
}
