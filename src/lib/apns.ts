import { connect, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * Apple push (APNs) for the iPhone app, written against Apple's documentation rather than pulled
 * in as a package, as `web-push.ts` is: an ES256 provider token (a JWT signed with the team's
 * `.p8` key) and one HTTP/2 request per phone. "Sending notification requests to APNs" and
 * "Establishing a token-based connection to APNs" in Apple's developer documentation.
 */

export type ApnsCredentials = {
  /** The `.p8` file's text: a PKCS#8 P-256 private key in PEM. */
  key: string;
  /** The key's 10-character ID, shown next to it in the Apple developer account. */
  keyId: string;
  /** The 10-character Team ID. */
  teamId: string;
  /** The app's bundle ID: the topic every notification is sent to. */
  bundleId: string;
};

export type ApnsEnvironment = "production" | "development";

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  development: "https://api.sandbox.push.apple.com",
};

/** Reads a `.p8` key, or says in a sentence why it is not one. */
export function parseApnsKey(pem: string): { ok: true; key: KeyObject } | { ok: false; error: string } {
  const text = pem.trim();
  if (!text.includes("-----BEGIN PRIVATE KEY-----")) {
    return { ok: false, error: "Paste the whole .p8 file, from -----BEGIN PRIVATE KEY----- to the END line." };
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(text);
  } catch {
    return { ok: false, error: "That key could not be read. Paste the .p8 file exactly as Apple gave it." };
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    return { ok: false, error: "That is not an Apple push key. APNs keys are P-256 (.p8) keys." };
  }
  return { ok: true, key };
}

const b64u = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The provider token: `{alg: ES256, kid}`, `{iss: teamId, iat}`, signed with the key. */
export function apnsProviderToken(credentials: Pick<ApnsCredentials, "key" | "keyId" | "teamId">, now = new Date()): string {
  const parsed = parseApnsKey(credentials.key);
  if (!parsed.ok) throw new Error(parsed.error);
  const header = b64u(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));
  const claims = b64u(JSON.stringify({ iss: credentials.teamId, iat: Math.floor(now.getTime() / 1000) }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: parsed.key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64u(signature)}`;
}

/**
 * Apple refuses a provider token older than an hour, and one replaced more often than every
 * 20 minutes (`TooManyProviderTokenUpdates`), so each is reused for most of its hour.
 */
const TOKEN_REUSE_MS = 45 * 60_000;
let cachedToken: { forKey: string; token: string; madeAt: number } | null = null;

function providerTokenFor(credentials: ApnsCredentials, now: Date): string {
  const forKey = `${credentials.teamId}:${credentials.keyId}:${credentials.key}`;
  if (cachedToken && cachedToken.forKey === forKey && now.getTime() - cachedToken.madeAt < TOKEN_REUSE_MS) {
    return cachedToken.token;
  }
  const token = apnsProviderToken(credentials, now);
  cachedToken = { forKey, token, madeAt: now.getTime() };
  return token;
}

/** Forgets the reused provider token: Apple rejected it, or the key changed. */
export function forgetApnsProviderToken() {
  cachedToken = null;
}

export type ApnsMessage = {
  title: string;
  body: string;
  /** Groups alerts of a kind in Notification Center. */
  threadId?: string;
  /**
   * Read by the app, not shown: what to open when the alert is tapped. Sent under `body`,
   * where expo-notifications looks for a remote notification's data (`content.data`).
   */
  data?: Record<string, string>;
};

/** A notification's JSON. Apple allows 4 KB; an alert here is a few hundred bytes. */
export function apnsPayload(message: ApnsMessage): string {
  return JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      ...(message.threadId ? { "thread-id": message.threadId } : {}),
    },
    ...(message.data ? { body: message.data } : {}),
  });
}

export type ApnsTarget = { token: string; environment: ApnsEnvironment };

export type ApnsResult =
  | { ok: true }
  | {
      ok: false;
      /** Apple says the phone will never take this token again: forget it. */
      gone: boolean;
      /** Apple refused the server's key, not the phone: no phone is at fault. */
      credentialsRejected: boolean;
      status: number | null;
      reason: string;
    };

/** Device tokens Apple says are no longer good for this app. */
const GONE_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered", "ExpiredToken"]);
/** Reasons that mean the key, key ID, team or bundle ID is wrong. */
const CREDENTIAL_REASONS = new Set([
  "InvalidProviderToken",
  "ExpiredProviderToken",
  "MissingProviderToken",
  "TooManyProviderTokenUpdates",
  "BadTopic",
  "TopicDisallowed",
  "MissingTopic",
]);

export const APNS_TOKEN_PATTERN = /^[0-9a-f]{64,200}$/;

function requestOnce(
  session: ClientHttp2Session,
  target: ApnsTarget,
  payload: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ApnsResult> {
  return new Promise((resolve) => {
    let request: ReturnType<ClientHttp2Session["request"]>;
    try {
      request = session.request({ ":method": "POST", ":path": `/3/device/${target.token}`, ...headers });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Could not reach Apple.";
      return resolve({ ok: false, gone: false, credentialsRejected: false, status: null, reason });
    }
    let status: number | null = null;
    let body = "";
    const timer = setTimeout(() => {
      request.close();
      resolve({ ok: false, gone: false, credentialsRejected: false, status: null, reason: "Apple did not answer in time." });
    }, timeoutMs);
    request.setEncoding("utf8");
    request.on("response", (h) => {
      status = Number(h[":status"]);
    });
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      clearTimeout(timer);
      if (status === 200) return resolve({ ok: true });
      let reason = `APNs answered ${status ?? "nothing"}`;
      try {
        const parsed = JSON.parse(body) as { reason?: unknown };
        if (typeof parsed.reason === "string") reason = parsed.reason;
      } catch {
        // Not JSON: keep the status.
      }
      resolve({
        ok: false,
        gone: status === 410 || GONE_REASONS.has(reason),
        credentialsRejected: CREDENTIAL_REASONS.has(reason),
        status,
        reason,
      });
    });
    request.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, gone: false, credentialsRejected: false, status: null, reason: err.message });
    });
    request.end(payload);
  });
}

export type ApnsSender = (
  targets: readonly ApnsTarget[],
  message: (target: ApnsTarget) => ApnsMessage,
  credentials: ApnsCredentials,
) => Promise<Map<string, ApnsResult>>;

/**
 * Sends to each phone, one HTTP/2 connection per Apple environment, and answers each token's
 * result. Never throws for a phone's failure; a connection that cannot be made fails every
 * phone behind it. `hosts` is only for tests, which talk to a local HTTP/2 server.
 */
export async function sendApns(
  targets: readonly ApnsTarget[],
  message: (target: ApnsTarget) => ApnsMessage,
  credentials: ApnsCredentials,
  options: { hosts?: Record<ApnsEnvironment, string>; now?: Date; timeoutMs?: number } = {},
): Promise<Map<string, ApnsResult>> {
  const results = new Map<string, ApnsResult>();
  if (targets.length === 0) return results;
  const hosts = options.hosts ?? APNS_HOSTS;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers = {
    authorization: `bearer ${providerTokenFor(credentials, options.now ?? new Date())}`,
    "apns-topic": credentials.bundleId,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "content-type": "application/json",
  };

  for (const environment of ["production", "development"] as const) {
    const batch = targets.filter((t) => t.environment === environment);
    if (batch.length === 0) continue;
    const session = connect(hosts[environment]);
    let connectError: Error | null = null;
    session.on("error", (err) => {
      connectError = err;
    });
    try {
      for (const target of batch) {
        const result = connectError
          ? { ok: false as const, gone: false, credentialsRejected: false, status: null, reason: (connectError as Error).message }
          : await requestOnce(session, target, apnsPayload(message(target)), headers, timeoutMs);
        results.set(target.token, result);
        if (!result.ok && result.credentialsRejected) forgetApnsProviderToken();
      }
    } finally {
      session.close();
    }
  }
  return results;
}
