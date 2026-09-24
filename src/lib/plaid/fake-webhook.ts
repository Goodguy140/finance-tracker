// Relative imports only, for the same reason as fake-client.ts: this is loaded by
// Playwright's own loader, which does not rewrite "@/..." aliases.
import { createHash, createPrivateKey, sign } from "node:crypto";
import type { PlaidWebhookVerificationKey } from "./types";

/**
 * The signing half of the fake Plaid, so tests can deliver webhooks the real verifier
 * accepts.
 *
 * The key pair below is a fixture, not a secret: it only ever verifies anything when the
 * fake client is in play, which `plaidFakeClientAllowed` confines to a sandbox deployment
 * that opted in with PLAID_FAKE_CLIENT=1. Against real Plaid the verifier fetches Plaid's
 * key by `kid`, and this one is never consulted.
 */

export const FAKE_WEBHOOK_KEY_ID = "fake-webhook-key-1";

const FAKE_WEBHOOK_PRIVATE_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "o-MmHt0bR6oG7MTTkvGhFhjfbIYkSkgnA8BtJ1r0NWw",
  y: "dsNPIATy5v2prgy8sXjJa_gUUaD9L4WX8_nREsE37eI",
  d: "f2OG3puCiECPFB4sjDLvnRWSu9G0GXEEf8FLx33o-Oo",
} as const;

export const FAKE_WEBHOOK_PUBLIC_KEY: PlaidWebhookVerificationKey = {
  alg: "ES256",
  crv: FAKE_WEBHOOK_PRIVATE_JWK.crv,
  kid: FAKE_WEBHOOK_KEY_ID,
  kty: FAKE_WEBHOOK_PRIVATE_JWK.kty,
  use: "sig",
  x: FAKE_WEBHOOK_PRIVATE_JWK.x,
  y: FAKE_WEBHOOK_PRIVATE_JWK.y,
  created_at: 1_700_000_000,
  expired_at: null,
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * A `Plaid-Verification` header value for `body`, signed the way Plaid signs: an ES256 JWT
 * whose payload carries the SHA-256 of the exact body bytes.
 *
 * `overrides` lets a test produce each specific failure — a stale `iat`, a hash for some
 * other body, a different `alg` — rather than only a generically broken token.
 */
export function signFakePlaidWebhook(
  body: string,
  overrides: { iat?: number; bodyHash?: string; alg?: string; kid?: string } = {},
): string {
  const header = {
    alg: overrides.alg ?? "ES256",
    kid: overrides.kid ?? FAKE_WEBHOOK_KEY_ID,
    typ: "JWT",
  };
  const payload = {
    iat: overrides.iat ?? Math.floor(Date.now() / 1000),
    request_body_sha256: overrides.bodyHash ?? createHash("sha256").update(body).digest("hex"),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey({ format: "jwk", key: { ...FAKE_WEBHOOK_PRIVATE_JWK } }),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}
