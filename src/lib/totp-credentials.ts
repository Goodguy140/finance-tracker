import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { encryptSecret, tryDecryptSecret } from "@/lib/security";
import { generateTotpSecret, matchTotp } from "@/lib/totp";

/**
 * Authenticator-app enrolment and verification against the database. Enrolment is two steps:
 * a secret is proposed (held in an `MfaChallenge` row for ten minutes, encrypted) and only
 * becomes the account's factor once a code from the app proves it was scanned. A wrong code
 * leaves the proposal in place, so a typo does not mean scanning again.
 */

const ENROLL_PURPOSE = "totp-enroll";
const ENROLL_TTL_MS = 10 * 60 * 1000;

export async function proposeTotpSecret(userId: string, client: PrismaClient = defaultPrisma) {
  const secret = generateTotpSecret();
  // One proposal at a time per user: an older QR code stops working when a new one is shown.
  await client.mfaChallenge.deleteMany({ where: { userId, purpose: ENROLL_PURPOSE } });
  const row = await client.mfaChallenge.create({
    data: { userId, purpose: ENROLL_PURPOSE, challenge: encryptSecret(secret), expiresAt: new Date(Date.now() + ENROLL_TTL_MS) },
    select: { id: true },
  });
  return { enrollmentId: row.id, secret };
}

export type ConfirmTotpResult = "ok" | "expired" | "wrong-code";

/** Turns a proposal into the account's authenticator app once `code` matches it. */
export async function confirmTotpEnrollment(
  userId: string,
  enrollmentId: string,
  code: string,
  now = Date.now(),
  client: PrismaClient = defaultPrisma,
): Promise<ConfirmTotpResult> {
  const row = await client.mfaChallenge.findUnique({ where: { id: enrollmentId } });
  if (!row || row.userId !== userId || row.purpose !== ENROLL_PURPOSE || row.expiresAt.getTime() <= now) return "expired";
  const secret = tryDecryptSecret(row.challenge);
  if (!secret) return "expired";
  const step = matchTotp(secret, code, now, null);
  if (step === null) return "wrong-code";
  const claimed = await client.mfaChallenge.deleteMany({ where: { id: enrollmentId } });
  if (claimed.count !== 1) return "expired";
  const data = { secretEncrypted: encryptSecret(secret), lastUsedStep: step, createdAt: new Date(now) };
  await client.totpCredential.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return "ok";
}

/**
 * Checks a code against the account's app and records its step, so the same code is refused
 * next time. The conditional update decides between two requests racing with one code.
 */
export async function verifyTotpForUser(
  userId: string,
  code: string,
  now = Date.now(),
  client: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const credential = await client.totpCredential.findUnique({ where: { userId } });
  if (!credential) return false;
  const secret = tryDecryptSecret(credential.secretEncrypted);
  if (!secret) return false;
  const step = matchTotp(secret, code, now, credential.lastUsedStep);
  if (step === null) return false;
  const claimed = await client.totpCredential.updateMany({
    where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
    data: { lastUsedStep: step },
  });
  return claimed.count === 1;
}
