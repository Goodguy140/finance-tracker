import { createDecipheriv, createECDH, hkdfSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  encryptPushPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  sendWebPush,
  vapidAuthorization,
  vapidPublicKeyObject,
} from "./web-push";

// RFC 8291 Appendix A: the RFC's published example keys, not credentials of anything here.
// `ggignore` tells the secret scanner so.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", // ggignore
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg", // ggignore
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** What a browser does with the body: the receiving half of RFC 8291. */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const record = body.subarray(21 + idLen);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  expect(padded[padded.length - 1]).toBe(2);
  return padded.subarray(0, padded.length - 1).toString("utf8");
}

describe("encryptPushPayload", () => {
  it("reproduces the RFC 8291 example byte for byte", () => {
    const body = encryptPushPayload(
      Buffer.from(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: Buffer.from(RFC.salt, "base64url"), serverPrivateKey: Buffer.from(RFC.asPrivate, "base64url") },
    );
    expect(body.toString("base64url")).toBe(RFC.body);
  });

  it("produces a body only the subscribing browser can read", () => {
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const body = encryptPushPayload(Buffer.from('{"title":"Hydro is due"}'), {
      p256dh: browser.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    });
    expect(decrypt(body, browser.getPrivateKey(), browser.getPublicKey(), auth)).toBe('{"title":"Hydro is due"}');
    expect(() => decrypt(body, browser.getPrivateKey(), browser.getPublicKey(), Buffer.alloc(16, 8))).toThrow();
  });
});

describe("vapidAuthorization", () => {
  it("signs a token for the endpoint's origin that the public key verifies", () => {
    const keys = generateVapidKeys();
    const now = new Date("2026-10-28T12:00:00Z");
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, "https://money.example", now);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match?.[4]).toBe(keys.publicKey);
    const [, h, c, s] = match!;
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
      sub: "https://money.example",
    });
    const key = { key: vapidPublicKeyObject(keys.publicKey), dsaEncoding: "ieee-p1363" as const };
    expect(verify("sha256", Buffer.from(`${h}.${c}`), key, Buffer.from(s, "base64url"))).toBe(true);
    expect(verify("sha256", Buffer.from(`${h}.${c}x`), key, Buffer.from(s, "base64url"))).toBe(false);
  });
});

describe("isAllowedPushEndpoint", () => {
  it("accepts the browsers' push services and nothing else", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-by3p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilpush.apple.com.test/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});

describe("sendWebPush", () => {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const target = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: browser.getPublicKey().toString("base64url"),
    auth: Buffer.alloc(16, 1).toString("base64url"),
  };
  const vapid = { keys: generateVapidKeys(), subject: "mailto:me@example.test" };

  it("posts an encrypted body with the push headers", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendWebPush(target, "hi", vapid, { fetchImpl, ttlSeconds: 60 })).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(target.endpoint);
    expect(init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "60" });
    expect(decrypt(Buffer.from(init.body as Uint8Array), browser.getPrivateKey(), browser.getPublicKey(), Buffer.alloc(16, 1))).toBe("hi");
  });

  it("reports a subscription the push service has dropped as gone", async () => {
    const gone = vi.fn(async () => new Response("expired", { status: 410 }));
    expect(await sendWebPush(target, "hi", vapid, { fetchImpl: gone })).toMatchObject({ ok: false, gone: true, status: 410 });
    const busy = vi.fn(async () => new Response("slow down", { status: 429 }));
    expect(await sendWebPush(target, "hi", vapid, { fetchImpl: busy })).toMatchObject({ ok: false, gone: false, status: 429 });
  });

  it("never calls an endpoint outside the push services", async () => {
    const fetchImpl = vi.fn();
    const result = await sendWebPush({ ...target, endpoint: "https://10.0.0.1/admin" }, "hi", vapid, { fetchImpl });
    expect(result).toMatchObject({ ok: false, gone: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
