import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { totpCode } from "./totp";

const dir = mkdtempSync(join(tmpdir(), "totp-"));
const url = `file:${join(dir, "totp.db")}`;
let db: PrismaClient;
let totp: typeof import("./totp-credentials");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  totp = await import("./totp-credentials");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `t${seq}@example.test`, displayName: "T" } })).id;
});

const now = Date.UTC(2026, 9, 28, 12, 0, 10);

describe("authenticator app enrolment", () => {
  it("turns on only with a code from the scanned secret, and a typo keeps the QR code valid", async () => {
    const { enrollmentId, secret } = await totp.proposeTotpSecret(userId, db);
    expect(await totp.confirmTotpEnrollment(userId, enrollmentId, "000000", now, db)).toBe("wrong-code");
    expect(await db.totpCredential.findUnique({ where: { userId } })).toBeNull();
    expect(await totp.confirmTotpEnrollment(userId, enrollmentId, totpCode(secret, now), now, db)).toBe("ok");
    const stored = await db.totpCredential.findUniqueOrThrow({ where: { userId } });
    expect(stored.secretEncrypted).not.toContain(secret);
    // The proposal is spent.
    expect(await totp.confirmTotpEnrollment(userId, enrollmentId, totpCode(secret, now), now, db)).toBe("expired");
  });

  it("refuses another user's or a lapsed proposal", async () => {
    const { enrollmentId, secret } = await totp.proposeTotpSecret(userId, db);
    const other = (await db.user.create({ data: { email: `o${seq}@example.test`, displayName: "O" } })).id;
    expect(await totp.confirmTotpEnrollment(other, enrollmentId, totpCode(secret, now), now, db)).toBe("expired");
    const later = Date.now() + 11 * 60_000;
    expect(await totp.confirmTotpEnrollment(userId, enrollmentId, totpCode(secret, later), later, db)).toBe("expired");
  });
});

describe("verifyTotpForUser", () => {
  it("accepts a fresh code once, never the same one twice", async () => {
    const { enrollmentId, secret } = await totp.proposeTotpSecret(userId, db);
    await totp.confirmTotpEnrollment(userId, enrollmentId, totpCode(secret, now), now, db);
    // The enrolment code's step is already used.
    expect(await totp.verifyTotpForUser(userId, totpCode(secret, now), now, db)).toBe(false);
    const next = now + 30_000;
    expect(await totp.verifyTotpForUser(userId, totpCode(secret, next), next, db)).toBe(true);
    expect(await totp.verifyTotpForUser(userId, totpCode(secret, next), next, db)).toBe(false);
    expect(await totp.verifyTotpForUser(userId, "123456", next + 30_000, db)).toBe(false);
  });

  it("is false for a user without an app", async () => {
    expect(await totp.verifyTotpForUser(userId, "123456", now, db)).toBe(false);
  });
});
