import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/**
 * Phone sign-in against a real SQLite database built from the migrations: the code handed to
 * the app, its exchange for a device token, that token on `/api/v1`, and every way it ends.
 */

const dir = mkdtempSync(join(tmpdir(), "app-devices-"));
const url = `file:${join(dir, "app-devices.db")}`;
let db: PrismaClient;
let lib: typeof import("./app-devices");
let authenticateApiToken: typeof import("./api-token").authenticateApiToken;

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  lib = await import("./app-devices");
  ({ authenticateApiToken } = await import("./api-token"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const VERIFIER = "a".repeat(20) + "-._~" + "Z9".repeat(10);
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
let userId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `phone${seq}@example.test`, displayName: "Phone" } })).id;
});

function authorizeRequest(verifier = VERIFIER) {
  const parsed = lib.parseAuthorizeRequest({
    code_challenge: lib.pkceChallengeFor(verifier),
    code_challenge_method: "S256",
    state: "st-1",
    device: "Sam's iPhone",
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.request;
}

async function signInPhone(now = Date.now()) {
  const created = await lib.createAppSignInCode({ userId, request: authorizeRequest() }, db, now);
  if (!created.ok) throw new Error(created.error);
  const exchanged = await lib.exchangeAppSignInCode({ code: created.code, codeVerifier: VERIFIER }, db, now);
  if (!exchanged.ok) throw new Error(exchanged.error);
  return exchanged;
}

function bearer(token: string) {
  return new Request("http://localhost/api/v1/transactions", { headers: { authorization: `Bearer ${token}` } });
}

describe("parseAuthorizeRequest", () => {
  const challenge = "x".repeat(43);

  it("refuses the plain PKCE method and any other redirect", () => {
    expect(lib.parseAuthorizeRequest({ code_challenge: challenge, code_challenge_method: "plain", state: "s" }).ok).toBe(false);
    expect(
      lib.parseAuthorizeRequest({ code_challenge: challenge, state: "s", redirect_uri: "https://evil.example/cb" }).ok,
    ).toBe(false);
    expect(lib.parseAuthorizeRequest({ code_challenge: challenge }).ok).toBe(false);
  });

  it("keeps a device name to one short line", () => {
    const parsed = lib.parseAuthorizeRequest({ code_challenge: challenge, state: "s", device: `My\nphone${"!".repeat(80)}` });
    expect(parsed.ok && parsed.request.deviceName).toBe(`My phone${"!".repeat(52)}`);
  });
});

describe("phone sign-in", () => {
  it("hands the app a token that works on /api/v1 as the person who allowed it", async () => {
    const { token, device } = await signInPhone();
    expect(token.startsWith("ftd_")).toBe(true);
    expect(device.name).toBe("Sam's iPhone");
    // Only the hash is stored.
    expect(await db.appDevice.count({ where: { tokenHash: token } })).toBe(0);

    const auth = await authenticateApiToken(bearer(token), "transactions:read", db);
    expect(auth.status).toBe("ok");
    if (auth.status === "ok") {
      expect(auth.user.id).toBe(userId);
      expect(auth.token).toEqual({ kind: "device", id: device.id });
    }
  });

  it("burns a code on its first use, even with the wrong verifier", async () => {
    const created = await lib.createAppSignInCode({ userId, request: authorizeRequest() }, db);
    if (!created.ok) throw new Error(created.error);
    const wrong = await lib.exchangeAppSignInCode({ code: created.code, codeVerifier: "b".repeat(43) }, db);
    expect(wrong.ok).toBe(false);
    const right = await lib.exchangeAppSignInCode({ code: created.code, codeVerifier: VERIFIER }, db);
    expect(right.ok).toBe(false);
    expect(await db.appDevice.count({ where: { userId } })).toBe(0);
  });

  it("refuses a code after its minute is up", async () => {
    const now = Date.now();
    const created = await lib.createAppSignInCode({ userId, request: authorizeRequest() }, db, now);
    if (!created.ok) throw new Error(created.error);
    const late = await lib.exchangeAppSignInCode(
      { code: created.code, codeVerifier: VERIFIER },
      db,
      now + lib.SIGN_IN_CODE_TTL_MS + 1,
    );
    expect(late.ok).toBe(false);
  });

  it("refuses another phone once the account has the most it may have", async () => {
    for (let i = 0; i < lib.MAX_APP_DEVICES; i += 1) await signInPhone();
    const created = await lib.createAppSignInCode({ userId, request: authorizeRequest() }, db);
    expect(created.ok).toBe(false);
  });
});

describe("how a phone is signed out", () => {
  it("a password change (tokenVersion bump) ends it and drops it from the list", async () => {
    const { token } = await signInPhone();
    await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    expect((await authenticateApiToken(bearer(token), "transactions:read", db)).status).toBe("unauthorized");
    expect(await lib.listAppDevices(userId, db)).toEqual([]);
  });

  it("idles out after 90 days unused, counted from its last use", async () => {
    const start = Date.now();
    const recent = await signInPhone(start);
    await db.appDevice.update({ where: { id: recent.device.id }, data: { lastUsedAt: new Date(start + 60 * DAY) } });
    expect((await lib.authenticateAppDevice(recent.token, db, start + 120 * DAY)).status).toBe("ok");

    const idle = await signInPhone(start);
    expect((await lib.authenticateAppDevice(idle.token, db, start + 91 * DAY)).status).toBe("unauthorized");
    expect(await db.appDevice.count({ where: { id: idle.device.id } })).toBe(0);
  });

  it("a suspended account's phone is refused", async () => {
    const { token } = await signInPhone();
    await db.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    expect((await authenticateApiToken(bearer(token), "transactions:read", db)).status).toBe("unauthorized");
  });

  it("Settings → Security signs out only the owner's phone", async () => {
    const { token, device } = await signInPhone();
    const stranger = await db.user.create({ data: { email: `stranger${seq}@example.test`, displayName: "S" } });
    expect(await lib.signOutAppDevice({ userId: stranger.id, deviceId: device.id }, db)).toBeNull();
    expect((await lib.authenticateAppDevice(token, db)).status).toBe("ok");

    expect((await lib.signOutAppDevice({ userId, deviceId: device.id }, db))?.id).toBe(device.id);
    expect((await lib.authenticateAppDevice(token, db)).status).toBe("unauthorized");
  });

  it("the app's own sign-out ends its token", async () => {
    const { token } = await signInPhone();
    expect(await lib.revokeAppDeviceToken(token, db)).not.toBeNull();
    expect((await lib.authenticateAppDevice(token, db)).status).toBe("unauthorized");
    expect(await lib.revokeAppDeviceToken(token, db)).toBeNull();
  });
});
