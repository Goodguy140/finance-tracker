import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * Face ID sign-in from the phone app, end to end against a real database and the real WebAuthn
 * check: the server's challenge, an assertion shaped as iOS returns it (signed by a P-256 key
 * registered the way the web settings page registers one), and the device token it buys.
 */

const RP_ID = "money.example.com";
process.env.NEXTAUTH_URL = `https://${RP_ID}`;

const dir = mkdtempSync(join(tmpdir(), "app-passkey-"));
const url = `file:${join(dir, "app-passkey.db")}`;
let db: PrismaClient;
let lib: typeof import("./app-passkey-sign-in");
let createAuthenticationOptions: typeof import("./webauthn").createAuthenticationOptions;
let authenticateApiToken: typeof import("./api-token").authenticateApiToken;
let MAX_APP_DEVICES: number;
let issueAppDeviceToken: typeof import("./app-devices").issueAppDeviceToken;

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  lib = await import("./app-passkey-sign-in");
  ({ createAuthenticationOptions } = await import("./webauthn"));
  ({ authenticateApiToken } = await import("./api-token"));
  ({ MAX_APP_DEVICES, issueAppDeviceToken } = await import("./app-devices"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let credentialId: string;
let privateKey: KeyObject;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `face${seq}@example.test`, displayName: "Face" } })).id;

  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  privateKey = pair.privateKey;
  const jwk = pair.publicKey.export({ format: "jwk" });
  const coseKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ]),
  );
  credentialId = isoBase64URL.fromBuffer(new TextEncoder().encode(`credential-${seq}`));
  await db.webAuthnCredential.create({
    data: {
      userId,
      credentialId,
      publicKey: isoBase64URL.fromBuffer(coseKey),
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      name: "iCloud Keychain",
    },
  });
});

/**
 * What the app sends: iOS's assertion with its bytes base64url-encoded. iOS writes the origin as
 * `https://<rp id>` and, for a synced passkey, a signature counter of 0.
 */
function iosAssertion(challenge: string, origin = `https://${RP_ID}`) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin }));
  const flags = 0x01 | 0x04 | 0x08 | 0x10; // user present, user verified, backup eligible, backed up
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(RP_ID).digest(),
    Buffer.from([flags]),
    Buffer.alloc(4),
  ]);
  const signed = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
      authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
      signature: isoBase64URL.fromBuffer(sign("sha256", signed, privateKey)),
      userHandle: isoBase64URL.fromBuffer(new TextEncoder().encode(userId)),
    },
  };
}

async function signIn(origin?: string) {
  const { challengeId, options } = await createAuthenticationOptions("signin", null);
  const response = iosAssertion(options.challenge, origin);
  const result = await lib.signInAppWithPasskey({ challengeId, response, deviceName: "Sam's iPhone", platform: "ios" }, { client: db });
  return { result, challengeId, response };
}

function bearer(token: string) {
  return new Request("http://localhost/api/v1/transactions", { headers: { authorization: `Bearer ${token}` } });
}

describe("Face ID sign-in from the app", () => {
  it("turns an iOS passkey assertion into a device token that works on /api/v1", async () => {
    const { result } = await signIn();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.startsWith("ftd_")).toBe(true);
    expect(result.device).toMatchObject({ userId, name: "Sam's iPhone", platform: "ios" });

    const auth = await authenticateApiToken(bearer(result.token), "transactions:read", db);
    expect(auth.status).toBe("ok");
    if (auth.status === "ok") expect(auth.user.id).toBe(userId);
  });

  it("accepts each challenge once", async () => {
    const { challengeId, response } = await signIn();
    const replay = await lib.signInAppWithPasskey({ challengeId, response, deviceName: "Other phone" }, { client: db });
    expect(replay).toMatchObject({ ok: false, status: 401 });
    expect(await db.appDevice.count({ where: { userId } })).toBe(1);
  });

  it("refuses an assertion made for another site", async () => {
    const { result } = await signIn("https://not-this-server.example");
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(await db.appDevice.count({ where: { userId } })).toBe(0);
  });

  it("refuses a suspended account", async () => {
    await db.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    const { result } = await signIn();
    expect(result).toMatchObject({ ok: false, status: 403, error: "This account has been suspended." });
    expect(await db.appDevice.count({ where: { userId } })).toBe(0);
  });

  it("refuses a new phone once the account has the most it may have", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    for (let i = 0; i < MAX_APP_DEVICES; i += 1) await issueAppDeviceToken({ user, deviceName: `Phone ${i}` }, db);
    const { result } = await signIn();
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(await db.appDevice.count({ where: { userId } })).toBe(MAX_APP_DEVICES);
  });

  it("refuses a request with no challenge or response without verifying anything", async () => {
    const verify = () => {
      throw new Error("must not verify");
    };
    expect(await lib.signInAppWithPasskey({ challengeId: "", response: {}, deviceName: "x" }, { client: db, verify })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await lib.signInAppWithPasskey({ challengeId: "c", response: "nope", deviceName: "x" }, { client: db, verify })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});
