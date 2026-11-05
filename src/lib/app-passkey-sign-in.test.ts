import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerIosPasskey } from "@/test-support/ios-passkey";
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
let passkey: Awaited<ReturnType<typeof registerIosPasskey>>;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `face${seq}@example.test`, displayName: "Face" } })).id;
  passkey = await registerIosPasskey(db, userId, RP_ID);
});

async function signIn(origin?: string) {
  const { challengeId, options } = await createAuthenticationOptions("signin", null);
  const response = passkey.assert(options.challenge, origin);
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
