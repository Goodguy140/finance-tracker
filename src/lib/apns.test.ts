import { generateKeyPairSync, verify } from "node:crypto";
import { createServer, type Http2Server, type IncomingHttpHeaders } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apnsPayload, apnsProviderToken, forgetApnsProviderToken, parseApnsKey, sendApns, type ApnsCredentials } from "./apns";

/**
 * Against a local HTTP/2 server standing in for Apple's, so the requests are real ones: the
 * path, the headers Apple requires, a provider token that verifies with the key's public half,
 * and Apple's answers read back the way Apple sends them.
 */

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const credentials: ApnsCredentials = {
  key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  keyId: "ABC123DEFG",
  teamId: "TEAM123456",
  bundleId: "com.example.app",
};

const GONE = "b".repeat(64);
const REFUSED = "c".repeat(64);
let server: Http2Server;
let host: string;
const seen: { headers: IncomingHttpHeaders; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ headers: req.headers, body });
      const token = String(req.headers[":path"]).split("/").pop();
      if (token === GONE) {
        res.writeHead(410, { "content-type": "application/json" }).end(JSON.stringify({ reason: "Unregistered" }));
      } else if (token === REFUSED) {
        res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ reason: "InvalidProviderToken" }));
      } else {
        res.writeHead(200).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  seen.length = 0;
  forgetApnsProviderToken();
});

function verifies(jwt: string): boolean {
  const [header, claims, signature] = jwt.split(".");
  return verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url"));
}

describe("apnsProviderToken", () => {
  it("is an ES256 token naming the key and the team, signed by the key", () => {
    const jwt = apnsProviderToken(credentials, new Date("2026-11-03T12:00:00Z"));
    const [header, claims] = jwt.split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url").toString()) as unknown);
    expect(header).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(claims).toEqual({ iss: "TEAM123456", iat: Date.parse("2026-11-03T12:00:00Z") / 1000 });
    expect(verifies(jwt)).toBe(true);
  });
});

it("refuses a key that is not an Apple push key", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  expect(parseApnsKey(rsa)).toMatchObject({ ok: false });
  expect(parseApnsKey("not a key")).toMatchObject({ ok: false });
  expect(parseApnsKey(credentials.key)).toMatchObject({ ok: true });
});

it("sends each phone its alert as Apple requires, and reads back what Apple says of each", async () => {
  const fine = "a".repeat(64);
  const results = await sendApns(
    [
      { token: fine, environment: "production" },
      { token: GONE, environment: "production" },
      { token: REFUSED, environment: "development" },
    ],
    (target) => ({ title: "Hydro is due", body: target.token === fine ? "$80.00 tomorrow" : "x", data: { kind: "billReminders" } }),
    credentials,
    { hosts: { production: host, development: host } },
  );

  expect(results.get(fine)).toEqual({ ok: true });
  expect(results.get(GONE)).toMatchObject({ ok: false, gone: true, credentialsRejected: false, status: 410 });
  expect(results.get(REFUSED)).toMatchObject({ ok: false, gone: false, credentialsRejected: true, reason: "InvalidProviderToken" });

  const first = seen.find((r) => r.headers[":path"] === `/3/device/${fine}`)!;
  expect(first.headers).toMatchObject({ ":method": "POST", "apns-topic": "com.example.app", "apns-push-type": "alert" });
  expect(verifies(String(first.headers.authorization).replace(/^bearer /, ""))).toBe(true);
  expect(JSON.parse(first.body)).toEqual({
    aps: { alert: { title: "Hydro is due", body: "$80.00 tomorrow" }, sound: "default" },
    kind: "billReminders",
  });
});

it("fails every phone, without throwing, when Apple cannot be reached", async () => {
  const results = await sendApns([{ token: "d".repeat(64), environment: "production" }], () => ({ title: "t", body: "b" }), credentials, {
    hosts: { production: "http://127.0.0.1:1", development: host },
  });
  expect(results.get("d".repeat(64))).toMatchObject({ ok: false, gone: false, credentialsRejected: false });
});

it("puts the thread in the payload only when there is one", () => {
  expect(JSON.parse(apnsPayload({ title: "t", body: "b", threadId: "budgetAlerts" })).aps["thread-id"]).toBe("budgetAlerts");
  expect(JSON.parse(apnsPayload({ title: "t", body: "b" })).aps).not.toHaveProperty("thread-id");
});
