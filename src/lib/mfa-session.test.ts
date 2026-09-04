import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const {
  MFA_COOKIE_MAX_AGE_S,
  readSignedPayload,
  readSsoLinkIntent,
  signMfaPayload,
  signPayload,
  verifyMfaPayload,
} = await import("./mfa-session");

const SECRET = "unit-test-secret";
const NOW = 1_800_000_000_000;

const base = { sub: "u1", sid: "s1", verifiedAt: NOW - 1000, method: "passkey" as const };

describe("MFA cookie payload", () => {
  it("round-trips a signed payload bound to the same user and login", () => {
    const raw = signMfaPayload(base, SECRET);
    expect(verifyMfaPayload(raw, { sub: "u1", sid: "s1", now: NOW, secret: SECRET })).toEqual(base);
  });

  it("rejects a tampered body even when the signature is intact", () => {
    const raw = signMfaPayload(base, SECRET);
    const [, mac] = raw.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...base, sub: "u2" })).toString("base64url")}.${mac}`;
    expect(verifyMfaPayload(forged, { sub: "u2", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
  });

  it("rejects a payload signed with a different secret", () => {
    const raw = signMfaPayload(base, "other-secret");
    expect(verifyMfaPayload(raw, { sub: "u1", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
  });

  it("is bound to the user id", () => {
    const raw = signMfaPayload(base, SECRET);
    expect(verifyMfaPayload(raw, { sub: "u2", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
  });

  it("is bound to the login (sid): a new sign-in needs a new verification", () => {
    const raw = signMfaPayload(base, SECRET);
    expect(verifyMfaPayload(raw, { sub: "u1", sid: "s2", now: NOW, secret: SECRET })).toBeNull();
  });

  it("expires with the session", () => {
    const raw = signMfaPayload(base, SECRET);
    const later = base.verifiedAt + MFA_COOKIE_MAX_AGE_S * 1000 + 1;
    expect(verifyMfaPayload(raw, { sub: "u1", sid: "s1", now: later, secret: SECRET })).toBeNull();
  });

  it("rejects a verifiedAt from the future", () => {
    const raw = signMfaPayload({ ...base, verifiedAt: NOW + 10 * 60_000 }, SECRET);
    expect(verifyMfaPayload(raw, { sub: "u1", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
  });

  it("rejects unknown methods and malformed values", () => {
    const raw = signPayload("mfa", { ...base, method: "sms" }, SECRET);
    expect(verifyMfaPayload(raw, { sub: "u1", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
    expect(verifyMfaPayload(undefined, { sub: "u1", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
    expect(verifyMfaPayload("not.a.cookie", { sub: "u1", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
    expect(verifyMfaPayload("garbage", { sub: "u1", sid: "s1", now: NOW, secret: SECRET })).toBeNull();
  });

  it("keys each purpose separately so an MFA cookie cannot pose as a link intent", () => {
    const raw = signPayload("mfa", { userId: "u1", provider: "google", challengeId: "c1", exp: NOW + 1 }, SECRET);
    expect(readSignedPayload("sso-link", raw, SECRET)).toBeNull();
    expect(readSignedPayload("mfa", raw, SECRET)).not.toBeNull();
  });
});

describe("SSO link intent", () => {
  const intent = { userId: "u1", provider: "google", challengeId: "c1", exp: NOW + 60_000 };

  it("reads a valid intent", () => {
    expect(readSsoLinkIntent(signPayload("sso-link", intent, SECRET), NOW, SECRET)).toEqual(intent);
  });

  it("rejects an expired intent", () => {
    expect(readSsoLinkIntent(signPayload("sso-link", intent, SECRET), intent.exp, SECRET)).toBeNull();
  });

  it("rejects incomplete intents", () => {
    const raw = signPayload("sso-link", { userId: "u1", provider: "google", exp: NOW + 1 }, SECRET);
    expect(readSsoLinkIntent(raw, NOW, SECRET)).toBeNull();
  });
});
