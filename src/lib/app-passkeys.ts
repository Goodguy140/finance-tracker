import type { PrismaClient, User } from "@prisma/client";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { appleAppId } from "@/lib/apple-app-site";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { clearRateLimit, enforceSlidingWindowRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { verifyTotpForUser } from "@/lib/totp-credentials";
import { passkeyNameSchema } from "@/lib/validation";
import { createRegistrationOptions, MfaVerificationError, verifyAuthentication, verifyRegistration } from "@/lib/webauthn";

/**
 * Adding a passkey from the phone app, as Settings → Security does on the website.
 *
 * A passkey is a way in, so a stolen device token must not be enough to add one. The website
 * asks for a fresh use of a factor the account already has, else the password, else a recent
 * sign-in (`proveEnrollment` in `src/app/actions/mfa.ts`). The phone asks for the first of those
 * it can: Face ID with one of the account's passkeys, else a code from its authenticator app.
 * The app never sees a password, so an account with neither adds its first passkey on the
 * website, which is also where the first factor's recovery codes are shown.
 *
 * iOS makes the passkey for the server's domain (the app's home server), so it also signs in
 * on the website, and syncs to the person's other Apple devices.
 */

export type AppPasskeyProofKind = "face-id" | "code";

/** What the phone asks for before it can add one; null when the first is added on the website. */
export function proofNeeded(factors: { passkeys: number; totp: boolean }): AppPasskeyProofKind | null {
  if (factors.passkeys > 0) return "face-id";
  if (factors.totp) return "code";
  return null;
}

const FIRST_ON_WEBSITE =
  "Add your first passkey on the website, in Settings → Security. It asks for your password there, which this app never sees.";
const TOTP_MAX_PER_USER = 10;
const TOTP_WINDOW_MS = 15 * 60 * 1000;

async function factorsOf(db: PrismaClient, userId: string) {
  const [passkeys, totp] = await Promise.all([
    db.webAuthnCredential.count({ where: { userId } }),
    db.totpCredential.count({ where: { userId } }),
  ]);
  return { passkeys, totp: totp > 0 };
}

/** `GET /api/v1/app/passkeys`: the account's passkeys, newest first, and what adding one asks for. */
export async function loadAppPasskeys(db: PrismaClient, userId: string) {
  const [rows, totp] = await Promise.all([
    db.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, backedUp: true },
    }),
    db.totpCredential.count({ where: { userId } }),
  ]);
  return {
    passkeys: rows.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      /** Synced (iCloud Keychain and the like) rather than kept on one device or security key. */
      synced: p.backedUp,
    })),
    /** How the phone confirms it's you before adding one: Face ID, an authenticator code, or neither. */
    proof: proofNeeded({ passkeys: rows.length, totp: totp > 0 }),
    /** The server names the app in its Apple app-site association, without which iOS refuses. */
    appLinking: appleAppId() !== null,
  };
}

export type AppPasskeyProof = {
  stepUp?: { challengeId: string; response: AuthenticationResponseJSON };
  code?: string;
};

type Failure = { ok: false; status: 400 | 401 | 403 | 429; error: string };

export type AppPasskeyDeps = {
  db: PrismaClient;
  /** The passkey check; resolves when the assertion is this user's, fresh and verified. */
  verifyStepUp?: (userId: string, stepUp: NonNullable<AppPasskeyProof["stepUp"]>) => Promise<boolean>;
  verifyCode?: (userId: string, code: string) => Promise<boolean>;
};

async function defaultVerifyStepUp(userId: string, stepUp: NonNullable<AppPasskeyProof["stepUp"]>): Promise<boolean> {
  try {
    await verifyAuthentication({ ...stepUp, purpose: "authenticate", expectedUserId: userId });
    return true;
  } catch {
    return false;
  }
}

/** Reads `{ stepUp?, code? }` from a request body; anything else is no proof at all. */
export function readProof(body: unknown): AppPasskeyProof {
  const fields = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const proof: AppPasskeyProof = {};
  const stepUp = fields.stepUp as Record<string, unknown> | undefined;
  if (stepUp && typeof stepUp === "object" && typeof stepUp.challengeId === "string" && stepUp.response && typeof stepUp.response === "object") {
    proof.stepUp = { challengeId: stepUp.challengeId, response: stepUp.response as AuthenticationResponseJSON };
  }
  if (typeof fields.code === "string") proof.code = fields.code.replace(/\s/g, "");
  return proof;
}

/**
 * Step 1: checks the proof the account calls for, then hands out a single-use registration
 * challenge for this user, as the website's `beginPasskeyRegistrationAction` does.
 */
export async function startAppPasskey(
  deps: AppPasskeyDeps,
  user: Pick<User, "id" | "email" | "displayName">,
  proof: AppPasskeyProof,
): Promise<{ ok: true; challengeId: string; options: PublicKeyCredentialCreationOptionsJSON } | Failure> {
  const factors = await factorsOf(deps.db, user.id);
  const needed = proofNeeded(factors);
  if (needed === null) return { ok: false, status: 403, error: FIRST_ON_WEBSITE };

  // Either factor the account has will do, as on the website; the phone asks for Face ID first.
  if (proof.stepUp && factors.passkeys > 0) {
    const confirmed = await (deps.verifyStepUp ?? defaultVerifyStepUp)(user.id, proof.stepUp);
    if (!confirmed) return { ok: false, status: 401, error: "Face ID did not confirm it was you. Try again." };
  } else if (proof.code && factors.totp) {
    const key = `app-passkey-code:${user.id}`;
    try {
      await enforceSlidingWindowRateLimit(key, TOTP_MAX_PER_USER, TOTP_WINDOW_MS, "Too many attempts. Try again later.");
    } catch (err) {
      if (err instanceof RateLimitExceededError) return { ok: false, status: 429, error: err.message };
      throw err;
    }
    const verified = await (deps.verifyCode ?? ((id, code) => verifyTotpForUser(id, code)))(user.id, proof.code);
    if (!verified) return { ok: false, status: 401, error: "That code didn't match. Check your authenticator app and try again." };
    await clearRateLimit(key);
  } else {
    return {
      ok: false,
      status: 400,
      error: needed === "face-id" ? "Confirm it's you with Face ID first." : "Enter the code from your authenticator app.",
    };
  }

  const { challengeId, options } = await createRegistrationOptions(user);
  return { ok: true, challengeId, options };
}

/**
 * Step 2: verifies what iOS made against the challenge from step 1 and keeps it, as the
 * website's `finishPasskeyRegistrationAction` does. The challenge is this user's, single-use and
 * short-lived, and only step 1's proof gets one, so nothing more is asked here. An account that
 * has lost every factor since step 1 is sent to the website, which issues recovery codes.
 */
export async function finishAppPasskey(
  deps: AppPasskeyDeps,
  input: { userId: string; challengeId: unknown; response: unknown; name: unknown; headers?: Headers },
): Promise<{ ok: true; passkey: { id: string; name: string; createdAt: string; synced: boolean } } | Failure> {
  const name = passkeyNameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, status: 400, error: "Give the passkey a name (1–40 characters)." };
  if (typeof input.challengeId !== "string" || !input.challengeId || !input.response || typeof input.response !== "object") {
    return { ok: false, status: 400, error: "Start again: the passkey did not arrive." };
  }
  if (proofNeeded(await factorsOf(deps.db, input.userId)) === null) return { ok: false, status: 403, error: FIRST_ON_WEBSITE };

  let credential: Awaited<ReturnType<typeof verifyRegistration>>;
  try {
    credential = await verifyRegistration({
      userId: input.userId,
      challengeId: input.challengeId,
      response: input.response as RegistrationResponseJSON,
      name: name.data,
    });
  } catch (err) {
    if (err instanceof MfaVerificationError) return { ok: false, status: 400, error: err.message };
    throw err;
  }
  await recordAuditLog(deps.db, {
    userId: input.userId,
    action: AUDIT_ACTIONS.passkey_registered,
    targetType: "webauthn_credential",
    targetId: credential.id,
    metadata: { name: credential.name, deviceType: credential.deviceType, backedUp: credential.backedUp, firstPasskey: false, from: "app" },
    headers: input.headers,
  });
  return {
    ok: true,
    passkey: { id: credential.id, name: credential.name, createdAt: credential.createdAt.toISOString(), synced: credential.backedUp },
  };
}
