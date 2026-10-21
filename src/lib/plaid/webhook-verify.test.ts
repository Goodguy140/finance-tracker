import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_WEBHOOK_PUBLIC_KEY, signFakePlaidWebhook } from "@/lib/plaid/fake-webhook";
import {
  clearWebhookKeyCache,
  FAILED_KEY_LOOKUP_TTL_MS,
  verifyPlaidWebhook,
  WEBHOOK_MAX_AGE_SECONDS,
} from "@/lib/plaid/webhook-verify";

const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: "item-1" });
const fetchKey = vi.fn(async () => ({ ...FAKE_WEBHOOK_PUBLIC_KEY }));

function b64(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("verifyPlaidWebhook", () => {
  beforeEach(() => {
    clearWebhookKeyCache();
    fetchKey.mockClear();
  });

  it("accepts a delivery signed over these exact bytes", async () => {
    const result = await verifyPlaidWebhook({ body, signedJwt: signFakePlaidWebhook(body), fetchKey });
    expect(result).toEqual({ ok: true });
  });

  it("caches the key by kid", async () => {
    await verifyPlaidWebhook({ body, signedJwt: signFakePlaidWebhook(body), fetchKey });
    await verifyPlaidWebhook({ body, signedJwt: signFakePlaidWebhook(body), fetchKey });
    expect(fetchKey).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing or malformed header", async () => {
    expect(await verifyPlaidWebhook({ body, signedJwt: null, fetchKey })).toMatchObject({ ok: false });
    expect(await verifyPlaidWebhook({ body, signedJwt: "a.b", fetchKey })).toMatchObject({ ok: false });
  });

  it("rejects a body that is not the one that was signed", async () => {
    const signed = signFakePlaidWebhook(body);
    const tampered = body.replace("LOGIN_REPAIRED", "NEW_ACCOUNTS_AVAILABLE");
    expect(await verifyPlaidWebhook({ body: tampered, signedJwt: signed, fetchKey })).toEqual({
      ok: false,
      reason: "body hash mismatch",
    });
  });

  it("rejects a stale delivery", async () => {
    const iat = Math.floor(Date.now() / 1000) - WEBHOOK_MAX_AGE_SECONDS - 5;
    expect(
      await verifyPlaidWebhook({ body, signedJwt: signFakePlaidWebhook(body, { iat }), fetchKey }),
    ).toEqual({ ok: false, reason: "stale" });
    // Refused on its face, before any key lookup.
    expect(fetchKey).not.toHaveBeenCalled();
  });

  it("rejects a forged signature", async () => {
    // A valid header and payload, re-signed by nobody: swap in another token's signature.
    const [h, p] = signFakePlaidWebhook(body).split(".");
    const [, , otherSig] = signFakePlaidWebhook("{}").split(".");
    expect(await verifyPlaidWebhook({ body, signedJwt: `${h}.${p}.${otherSig}`, fetchKey })).toEqual({
      ok: false,
      reason: "bad signature",
    });
  });

  it("refuses alg=none before fetching any key", async () => {
    const payload = {
      iat: Math.floor(Date.now() / 1000),
      request_body_sha256: createHash("sha256").update(body).digest("hex"),
    };
    const unsigned = `${b64({ alg: "none", kid: FAKE_WEBHOOK_PUBLIC_KEY.kid })}.${b64(payload)}.`;
    expect(await verifyPlaidWebhook({ body, signedJwt: unsigned, fetchKey })).toEqual({
      ok: false,
      reason: "unexpected alg",
    });
    expect(fetchKey).not.toHaveBeenCalled();
  });

  it("rejects a key Plaid has retired, or one it does not know", async () => {
    const expired = vi.fn(async () => ({ ...FAKE_WEBHOOK_PUBLIC_KEY, expired_at: 1_700_000_100 }));
    expect(
      await verifyPlaidWebhook({ body, signedJwt: signFakePlaidWebhook(body), fetchKey: expired }),
    ).toEqual({ ok: false, reason: "expired key" });

    clearWebhookKeyCache();
    const unknown = vi.fn(async () => {
      throw new Error("INVALID_WEBHOOK_VERIFICATION_KEY_ID");
    });
    expect(
      await verifyPlaidWebhook({ body, signedJwt: signFakePlaidWebhook(body), fetchKey: unknown }),
    ).toEqual({ ok: false, reason: "unknown key" });
  });

  it("does not ask Plaid again about a kid it just said it does not know", async () => {
    const unknown = vi.fn(async () => {
      throw new Error("INVALID_WEBHOOK_VERIFICATION_KEY_ID");
    });
    const signed = signFakePlaidWebhook(body);
    for (let i = 0; i < 5; i++) {
      expect(await verifyPlaidWebhook({ body, signedJwt: signed, fetchKey: unknown })).toEqual({
        ok: false,
        reason: "unknown key",
      });
    }
    expect(unknown).toHaveBeenCalledTimes(1);

    // After the wait, a kid Plaid has since published is looked up again.
    const later = new Date(Date.now() + FAILED_KEY_LOOKUP_TTL_MS + 1000);
    const resigned = signFakePlaidWebhook(body, { iat: Math.floor(later.getTime() / 1000) });
    expect(await verifyPlaidWebhook({ body, signedJwt: resigned, fetchKey, now: later })).toEqual({ ok: true });
  });

});
