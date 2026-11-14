import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient, User } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeIosPasskey, registerIosPasskey } from "@/test-support/ios-passkey";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { totpCode } from "./totp";

/**
 * Adding a passkey from the phone, against a real database and the real WebAuthn checks: what it
 * asks for first (Face ID with a passkey the account has, else an authenticator code, else the
 * website), and that the passkey kept is one that then signs in.
 */

const RP_ID = "money.example.com";
process.env.NEXTAUTH_URL = `https://${RP_ID}`;

const dir = mkdtempSync(join(tmpdir(), "app-passkeys-"));
const url = `file:${join(dir, "app-passkeys.db")}`;
let db: PrismaClient;
let lib: typeof import("./app-passkeys");
let webauthn: typeof import("./webauthn");
let totp: typeof import("./totp-credentials");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  lib = await import("./app-passkeys");
  webauthn = await import("./webauthn");
  totp = await import("./totp-credentials");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let user: User;
beforeEach(async () => {
  seq += 1;
  user = await db.user.create({ data: { email: `pk${seq}@example.test`, displayName: "Sam" } });
});

const deps = () => ({ db });

/** Face ID in the app: the server's step-up challenge for `forUserId`, signed with `passkey`. */
async function faceId(passkey: Awaited<ReturnType<typeof registerIosPasskey>>, forUserId = user.id) {
  const { challengeId, options } = await webauthn.createAuthenticationOptions("authenticate", forUserId);
  return { challengeId, response: passkey.assert(options.challenge) as never };
}

describe("adding a passkey from the phone", () => {
  it("asks for Face ID with a passkey the account has, then keeps one that signs in", async () => {
    const existing = await registerIosPasskey(db, user.id, RP_ID);
    expect((await lib.loadAppPasskeys(db, user.id)).proof).toBe("face-id");

    const started = await lib.startAppPasskey(deps(), user, { stepUp: await faceId(existing) });
    if (!started.ok) throw new Error(started.error);
    // iOS is told not to make a second passkey where the account already has one.
    expect(started.options.excludeCredentials?.map((c) => c.id)).toEqual([existing.credentialId]);

    const made = makeIosPasskey(started.options);
    const finished = await lib.finishAppPasskey(deps(), { userId: user.id, challengeId: started.challengeId, response: made.response, name: "Sam's iPhone" });
    expect(finished).toMatchObject({ ok: true, passkey: { name: "Sam's iPhone", synced: true } });

    const listed = await lib.loadAppPasskeys(db, user.id);
    expect(listed.passkeys.map((p) => p.name)).toEqual(["Sam's iPhone", "iCloud Keychain"]);
    expect(await db.auditLog.count({ where: { userId: user.id, action: "passkey_registered" } })).toBe(1);

    const signIn = await webauthn.createAuthenticationOptions("signin", null);
    const signedIn = await webauthn.verifyPasskeySignIn(signIn.challengeId, JSON.stringify(made.assert(signIn.options.challenge)));
    expect(signedIn?.id).toBe(user.id);

    // The challenge is spent: the same registration cannot be kept twice.
    const again = await lib.finishAppPasskey(deps(), { userId: user.id, challengeId: started.challengeId, response: made.response, name: "Again" });
    expect(again).toMatchObject({ ok: false, status: 400 });
  });

  it("hands out nothing without Face ID from this account", async () => {
    const existing = await registerIosPasskey(db, user.id, RP_ID);
    const other = await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } });
    const othersKey = await registerIosPasskey(db, other.id, RP_ID);

    expect(await lib.startAppPasskey(deps(), user, {})).toMatchObject({ ok: false, status: 400 });
    // A code is no proof for an account without an authenticator app.
    expect(await lib.startAppPasskey(deps(), user, { code: "123456" })).toMatchObject({ ok: false, status: 400 });
    expect(await lib.startAppPasskey(deps(), user, { stepUp: await faceId(othersKey, other.id) })).toMatchObject({ ok: false, status: 401 });
    expect(await db.mfaChallenge.count({ where: { userId: user.id, purpose: "register" } })).toBe(0);
    expect((await lib.startAppPasskey(deps(), user, { stepUp: await faceId(existing) })).ok).toBe(true);
  });

  it("asks an account with only an authenticator app for its code", async () => {
    const enrolledAt = Date.now() - 120_000;
    const { enrollmentId, secret } = await totp.proposeTotpSecret(user.id, db);
    expect(await totp.confirmTotpEnrollment(user.id, enrollmentId, totpCode(secret, enrolledAt), enrolledAt, db)).toBe("ok");
    expect((await lib.loadAppPasskeys(db, user.id)).proof).toBe("code");

    expect(await lib.startAppPasskey(deps(), user, { code: "000000" })).toMatchObject({ ok: false, status: 401 });
    const started = await lib.startAppPasskey(deps(), user, { code: totpCode(secret, Date.now()) });
    if (!started.ok) throw new Error(started.error);
    const made = makeIosPasskey(started.options);
    expect(await lib.finishAppPasskey(deps(), { userId: user.id, challengeId: started.challengeId, response: made.response, name: "iPhone" })).toMatchObject({
      ok: true,
    });
  });

  it("sends an account with no second factor to the website, where its recovery codes are shown", async () => {
    expect((await lib.loadAppPasskeys(db, user.id)).proof).toBeNull();
    expect(await lib.startAppPasskey(deps(), user, {})).toMatchObject({ ok: false, status: 403 });
    // Nor can it finish one started elsewhere: its first factor comes with recovery codes.
    const { challengeId, options } = await webauthn.createRegistrationOptions(user);
    const made = makeIosPasskey(options);
    expect(await lib.finishAppPasskey(deps(), { userId: user.id, challengeId, response: made.response, name: "iPhone" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await db.webAuthnCredential.count({ where: { userId: user.id } })).toBe(0);
  });
});
