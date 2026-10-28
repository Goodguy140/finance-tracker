import { createECDH, createPrivateKey, createPublicKey, hkdfSync, createCipheriv, randomBytes, sign } from "node:crypto";

/**
 * Web Push, written against the RFCs rather than pulled in as a package: message encryption
 * (RFC 8291, `aes128gcm` from RFC 8188) and VAPID (RFC 8292). Everything here is pure: the
 * keys, the subscription and `fetch` come in as arguments, so the RFC test vectors can be
 * checked byte for byte (`web-push.test.ts`).
 */

export type VapidKeys = {
  /** Uncompressed P-256 point, base64url (65 bytes). This is the browser's `applicationServerKey`. */
  publicKey: string;
  /** The private scalar `d`, base64url (32 bytes). */
  privateKey: string;
};

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

const b64u = (buf: Buffer) => buf.toString("base64url");
const fromB64u = (text: string) => Buffer.from(text, "base64url");

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** One record of at most 4096 bytes; a notification body is a few hundred. */
const RECORD_SIZE = 4096;
/** 16-byte GCM tag plus the 1-byte padding delimiter. */
const RECORD_OVERHEAD = 17;
export const MAX_PUSH_PLAINTEXT = RECORD_SIZE - RECORD_OVERHEAD - 86;

/**
 * Encrypts `plaintext` for one subscription. `salt` and `serverPrivateKey` are random per
 * message; they are parameters only so the RFC 8291 appendix vector can be reproduced.
 */
export function encryptPushPayload(
  plaintext: Buffer,
  target: Pick<PushTarget, "p256dh" | "auth">,
  fixed: { salt?: Buffer; serverPrivateKey?: Buffer } = {},
): Buffer {
  if (plaintext.length > MAX_PUSH_PLAINTEXT) throw new Error("Push message is too long.");
  const uaPublic = fromB64u(target.p256dh);
  const authSecret = fromB64u(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("Invalid subscription key.");
  if (authSecret.length !== 16) throw new Error("Invalid subscription auth secret.");

  const ecdh = createECDH("prime256v1");
  if (fixed.serverPrivateKey) ecdh.setPrivateKey(fixed.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const salt = fixed.salt ?? randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // A single record, so it is also the last: padding delimiter 0x02, no further padding.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

function vapidPrivateKeyObject(keys: VapidKeys) {
  const pub = fromB64u(keys.publicKey);
  return createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

export function vapidPublicKeyObject(publicKey: string) {
  const pub = fromB64u(publicKey);
  return createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

/** VAPID token lifetime; the spec caps it at 24 hours. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;

/** The `Authorization` header for one push service (`aud` is the endpoint's origin). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = new Date()): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + VAPID_TTL_SECONDS, sub: subject }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key: vapidPrivateKeyObject(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${signingInput}.${b64u(signature)}, k=${keys.publicKey}`;
}

/**
 * Push services this server will post to. The endpoint comes from the browser, so without a
 * list a signed-in user could point the server at any URL it can reach. These are the services
 * browsers actually hand out: Chrome/Edge/Android (FCM), Firefox, Safari/iOS and Windows.
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export type PushSendResult = { ok: true } | { ok: false; gone: boolean; status: number | null; error: string };

/**
 * Delivers one message. `gone` means the subscription no longer exists (404/410: the person
 * turned notifications off or reinstalled) and the device row should be dropped.
 */
export async function sendWebPush(
  target: PushTarget,
  payload: string,
  vapid: { keys: VapidKeys; subject: string },
  options: { ttlSeconds?: number; urgency?: "normal" | "high"; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<PushSendResult> {
  if (!isAllowedPushEndpoint(target.endpoint)) return { ok: false, gone: true, status: null, error: "Not a push service" };
  const body = encryptPushPayload(Buffer.from(payload, "utf8"), target);
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(target.endpoint, vapid.keys, vapid.subject, options.now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttlSeconds ?? 24 * 60 * 60),
        Urgency: options.urgency ?? "normal",
      },
      body: new Uint8Array(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, gone: false, status: null, error: err instanceof Error ? err.message : "Request failed" };
  }
  if (response.status >= 200 && response.status < 300) return { ok: true };
  return {
    ok: false,
    gone: response.status === 404 || response.status === 410,
    status: response.status,
    error: (await response.text().catch(() => "")).slice(0, 200) || `HTTP ${response.status}`,
  };
}
