import { compare, hash } from "bcryptjs";
import { randomBytes } from "crypto";
import type { User, WebAuthnCredential } from "@prisma/client";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { prisma } from "@/lib/prisma";
import { getWebAuthnRp } from "@/lib/webauthn-rp";

/**
 * Passkey ceremonies and recovery codes. Everything here is server-side and DB-backed;
 * the session-facing half (which login is verified, step-up freshness) is `mfa-session.ts`.
 *
 * User verification is *required* on every ceremony, not merely preferred: the same
 * credentials double as a passwordless first factor, so possession of an unlocked device
 * must not be enough on its own.
 */

export class MfaVerificationError extends Error {
  constructor(message = "Passkey verification failed. Try again.") {
    super(message);
    this.name = "MfaVerificationError";
  }
}

export type ChallengePurpose = "register" | "authenticate" | "signin" | "sso-link";
// "totp-enroll" rows are written and read by `totp-credentials.ts`, not through these helpers.

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Delete expired challenge rows roughly once in this many `createChallenge` calls. */
const SWEEP_ODDS = 20;

export const RECOVERY_CODE_COUNT = 8;
/** RFC 4648 base32 alphabet, lower-cased: no ambiguous 0/1/8 and easy to read back. */
const RECOVERY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const RECOVERY_CODE_LENGTH = 10;

function parseTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  return value.split(",").filter(Boolean) as AuthenticatorTransportFuture[];
}

export async function createChallenge(
  purpose: ChallengePurpose,
  userId: string | null,
  challenge: string,
  ttlMs = CHALLENGE_TTL_MS,
): Promise<{ id: string }> {
  await maybeSweepExpiredChallenges();
  return prisma.mfaChallenge.create({
    data: { purpose, userId, challenge, expiresAt: new Date(Date.now() + ttlMs) },
    select: { id: true },
  });
}

/**
 * Single use: the row is deleted before anything is verified against it, and the delete
 * is what decides the winner if two requests race for the same challenge.
 */
export async function consumeChallenge(
  id: string,
  purpose: ChallengePurpose,
  expectedUserId: string | null,
): Promise<string | null> {
  const row = await prisma.mfaChallenge.findUnique({ where: { id } });
  if (!row || row.purpose !== purpose || row.userId !== expectedUserId) return null;
  const deleted = await prisma.mfaChallenge.deleteMany({
    where: { id, expiresAt: { gt: new Date() } },
  });
  return deleted.count === 1 ? row.challenge : null;
}

async function maybeSweepExpiredChallenges() {
  if (Math.floor(Math.random() * SWEEP_ODDS) !== 0) return;
  try {
    await prisma.mfaChallenge.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  } catch {
    // Housekeeping must never fail the ceremony it piggybacked on.
  }
}

export async function countPasskeys(userId: string): Promise<number> {
  return prisma.webAuthnCredential.count({ where: { userId } });
}

export async function createRegistrationOptions(
  user: Pick<User, "id" | "email" | "displayName">,
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const rp = getWebAuthnRp();
  const existing = await prisma.webAuthnCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.displayName,
    // Stable user handle so an authenticator replaces rather than duplicates a passkey
    // for the same account. Opaque cuid, no PII.
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: parseTransports(c.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const { id: challengeId } = await createChallenge("register", user.id, options.challenge);
  return { challengeId, options };
}

/**
 * The browser response arrives as an untyped action argument. Anything that is not an
 * object with a string `id` is rejected here with the usual generic error, rather than
 * reaching Prisma and echoing its validation message back to the client.
 */
function hasCredentialId(response: unknown): response is { id: string } {
  return (
    typeof response === "object" &&
    response !== null &&
    typeof (response as { id?: unknown }).id === "string" &&
    (response as { id: string }).id.length > 0
  );
}

export async function verifyRegistration(params: {
  userId: string;
  challengeId: string;
  response: RegistrationResponseJSON;
  name: string;
}): Promise<WebAuthnCredential> {
  if (!hasCredentialId(params.response)) throw new MfaVerificationError();
  const rp = getWebAuthnRp();
  const expectedChallenge = await consumeChallenge(params.challengeId, "register", params.userId);
  if (!expectedChallenge) throw new MfaVerificationError("This passkey setup expired. Start again.");

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: params.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new MfaVerificationError(err instanceof Error ? `Passkey could not be registered: ${err.message}` : undefined);
  }
  if (!verification.verified || !verification.registrationInfo) throw new MfaVerificationError();

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  return prisma.webAuthnCredential.create({
    data: {
      userId: params.userId,
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports?.length ? credential.transports.join(",") : null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: params.name,
    },
  });
}

/**
 * `allowCredentials` is deliberately empty: every passkey is registered as a discoverable
 * credential, so the browser can pick one without us listing ids — which also means the
 * `/mfa` wall does not hand a password-only attacker the account's credential ids.
 */
export async function createAuthenticationOptions(
  purpose: "authenticate" | "signin",
  userId: string | null,
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const rp = getWebAuthnRp();
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required",
    allowCredentials: [],
  });
  const { id: challengeId } = await createChallenge(purpose, userId, options.challenge);
  return { challengeId, options };
}

export async function verifyAuthentication(params: {
  challengeId: string;
  response: AuthenticationResponseJSON;
  purpose: "authenticate" | "signin";
  /** Required for `authenticate` (the session user); null for passwordless sign-in. */
  expectedUserId: string | null;
}): Promise<{ user: User; credential: WebAuthnCredential }> {
  if (!hasCredentialId(params.response)) throw new MfaVerificationError();
  const rp = getWebAuthnRp();
  const expectedChallenge = await consumeChallenge(params.challengeId, params.purpose, params.expectedUserId);
  if (!expectedChallenge) throw new MfaVerificationError("This passkey prompt expired. Try again.");

  const stored = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: params.response.id },
    include: { user: true },
  });
  if (!stored || (params.expectedUserId && stored.userId !== params.expectedUserId)) {
    throw new MfaVerificationError("That passkey is not registered for this account.");
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: stored.credentialId,
        publicKey: isoBase64URL.toBuffer(stored.publicKey),
        counter: stored.counter,
        transports: parseTransports(stored.transports),
      },
      requireUserVerification: true,
    });
  } catch {
    throw new MfaVerificationError();
  }
  if (!verification.verified) throw new MfaVerificationError();

  const { newCounter, credentialBackedUp } = verification.authenticationInfo;
  const credential = await prisma.webAuthnCredential.update({
    where: { id: stored.id },
    data: { counter: newCounter, backedUp: credentialBackedUp, lastUsedAt: new Date() },
  });
  return { user: stored.user, credential };
}

/**
 * Passwordless first factor for the `passkey` credentials provider. Returns null on any
 * failure — `authorize` maps that to NextAuth's generic CredentialsSignin, which is all a
 * login form should ever learn.
 */
export async function verifyPasskeySignIn(challengeId: string, responseJson: string): Promise<User | null> {
  let response: AuthenticationResponseJSON;
  try {
    response = JSON.parse(responseJson) as AuthenticationResponseJSON;
  } catch {
    return null;
  }
  if (!response || typeof response !== "object" || typeof response.id !== "string") return null;
  try {
    const { user } = await verifyAuthentication({ challengeId, response, purpose: "signin", expectedUserId: null });
    return user;
  } catch {
    return null;
  }
}

function randomRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += RECOVERY_ALPHABET[b & 31];
  return out;
}

export function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Replaces any existing set. Returns the display form; only bcrypt hashes are stored. */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const raws = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  const hashes = await Promise.all(raws.map((code) => hash(code, 10)));
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) }),
  ]);
  return raws.map(formatRecoveryCode);
}

/** `normalizedCode` is the 10-char form (see `recoveryCodeSchema`). */
export async function redeemRecoveryCode(userId: string, normalizedCode: string): Promise<boolean> {
  const candidates = await prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });
  for (const candidate of candidates) {
    if (await compare(normalizedCode, candidate.codeHash)) {
      const marked = await prisma.recoveryCode.updateMany({
        where: { id: candidate.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return marked.count === 1;
    }
  }
  return false;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}
