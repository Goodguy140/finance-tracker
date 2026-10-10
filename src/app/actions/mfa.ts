"use server";

import { compare } from "bcryptjs";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AUDIT_ACTIONS, clientMetaFromHeaders, recordAuditLog } from "@/lib/audit-log";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import { getAuthentikProvider, getGoogleProvider } from "@/lib/oauth-provider-config";
import {
  clearMfaCookie,
  setMfaVerifiedCookie,
  setSsoLinkCookie,
  SSO_LINK_MAX_AGE_S,
} from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { clearRateLimit, enforceSlidingWindowRateLimit } from "@/lib/rate-limit";
import {
  MfaStepUpRequiredError,
  requireFreshMfa,
  requireSessionUser,
  requireUser,
  type MfaStepUpCode,
} from "@/lib/session";
import {
  beginPasskeyRegistrationSchema,
  passkeyRowIdSchema,
  recoveryCodeSchema,
  renamePasskeySchema,
  ssoLinkProviderSchema,
} from "@/lib/validation";
import {
  createAuthenticationOptions,
  createChallenge,
  createRegistrationOptions,
  generateRecoveryCodes,
  MfaVerificationError,
  redeemRecoveryCode,
  verifyAuthentication,
  verifyRegistration,
} from "@/lib/webauthn";
import {
  getFormValue,
  formAction,
} from "./_helpers";

const WINDOW_MS = 15 * 60 * 1000;
const ENROLL_PASSWORD_MAX = 5;
const VERIFY_MAX_PER_USER = 10;
const RECOVERY_MAX = 5;
const PASSKEY_SIGNIN_MAX_PER_IP = 20;
const TOO_MANY = "Too many attempts. Please try again later.";
const SSO_REAUTH_MESSAGE =
  "To add your first passkey, sign out and sign back in with your SSO provider, then add it within 5 minutes.";

export type MfaActionFailure = { ok: false; error: string; code?: MfaStepUpCode };

export type BeginRegistrationResult =
  | { ok: true; challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }
  | MfaActionFailure;

export type FinishRegistrationResult =
  | { ok: true; passkeyId: string; recoveryCodes: string[] | null }
  | MfaActionFailure;

export type BeginAuthenticationResult =
  | { ok: true; challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }
  | MfaActionFailure;

export type SimpleMfaResult = { ok: true } | MfaActionFailure;

export type RecoveryCodesResult = { ok: true; codes: string[] } | MfaActionFailure;

function failure(err: unknown, fallback: string): MfaActionFailure {
  if (err instanceof MfaStepUpRequiredError) return { ok: false, error: err.message, code: err.code };
  if (err instanceof MfaVerificationError) return { ok: false, error: err.message };
  return { ok: false, error: err instanceof Error && err.message ? err.message : fallback };
}

async function clientIp(): Promise<string | undefined> {
  return clientMetaFromHeaders(await headers()).ipAddress;
}

/**
 * Step 1 of adding a passkey. The *first* passkey is what turns MFA on, so it must not be
 * something a stolen session cookie can do on its own:
 *
 * - if the account already has passkeys, a fresh assertion from one of them (step-up);
 * - if the account has a password, the user is asked to re-enter it;
 * - if the account is SSO-only (nothing to re-ask for), the login itself must be recent,
 *   so the user signs in with their provider again and enrols within the step-up window.
 */
export async function beginPasskeyRegistrationAction(input: {
  name: string;
  currentPassword?: string;
}): Promise<BeginRegistrationResult> {
  const parsed = beginPasskeyRegistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the passkey a name (1–40 characters)." };

  const loaded = await requireSessionUser();
  const { user, mfa, authAt } = loaded;

  try {
    if (mfa.required) {
      await requireFreshMfa();
    } else if (user.passwordHash) {
      const key = `passkey-enroll:${user.id}`;
      await enforceSlidingWindowRateLimit(key, ENROLL_PASSWORD_MAX, WINDOW_MS, TOO_MANY);
      const password = parsed.data.currentPassword ?? "";
      if (!password || !(await compare(password, user.passwordHash))) {
        return { ok: false, error: "Current password is incorrect." };
      }
      await clearRateLimit(key);
    } else if (authAt == null || Date.now() - authAt > MFA_STEP_UP_MAX_AGE_MS) {
      return { ok: false, error: SSO_REAUTH_MESSAGE };
    }
    const { challengeId, options } = await createRegistrationOptions(user);
    return { ok: true, challengeId, options };
  } catch (err) {
    return failure(err, "Could not start passkey setup.");
  }
}

/** Step 2: verify the authenticator's response and, for the first passkey, issue recovery codes. */
export async function finishPasskeyRegistrationAction(input: {
  challengeId: string;
  response: RegistrationResponseJSON;
  name: string;
}): Promise<FinishRegistrationResult> {
  const parsed = beginPasskeyRegistrationSchema.pick({ name: true }).safeParse({ name: input.name });
  if (!parsed.success) return { ok: false, error: "Give the passkey a name (1–40 characters)." };
  const loaded = await requireSessionUser();
  const { user, sid, mfa } = loaded;

  try {
    const credential = await verifyRegistration({
      userId: user.id,
      challengeId: input.challengeId,
      response: input.response,
      name: parsed.data.name,
    });
    const firstPasskey = !mfa.required;
    const recoveryCodes = firstPasskey ? await generateRecoveryCodes(user.id) : null;

    // A registration ceremony with user verification is itself a fresh proof of possession.
    // Without this the very next `requireUser()` would see "passkey enrolled, not verified"
    // and bounce the user who just enrolled straight to the /mfa wall.
    await setMfaVerifiedCookie({ userId: user.id, sid, method: "enroll" });

    const h = await headers();
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.passkey_registered,
      targetType: "webauthn_credential",
      targetId: credential.id,
      metadata: { name: credential.name, deviceType: credential.deviceType, backedUp: credential.backedUp, firstPasskey },
      headers: h,
    });
    if (recoveryCodes) {
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.recovery_codes_generated,
        metadata: { count: recoveryCodes.length, reason: "first_passkey" },
        headers: h,
      });
    }
    revalidatePath("/settings", "layout");
    return { ok: true, passkeyId: credential.id, recoveryCodes };
  } catch (err) {
    return failure(err, "Passkey could not be registered.");
  }
}

/** Used both by the `/mfa` wall and for step-up on an already-verified login. */
export async function beginPasskeyAuthenticationAction(): Promise<BeginAuthenticationResult> {
  const loaded = await requireSessionUser();
  if (!loaded.mfa.required) {
    return { ok: false, error: new MfaStepUpRequiredError("mfa_required").message, code: "mfa_required" };
  }
  try {
    const { challengeId, options } = await createAuthenticationOptions("authenticate", loaded.user.id);
    return { ok: true, challengeId, options };
  } catch (err) {
    return failure(err, "Could not start passkey verification.");
  }
}

export async function finishPasskeyAuthenticationAction(input: {
  challengeId: string;
  response: AuthenticationResponseJSON;
}): Promise<SimpleMfaResult> {
  const loaded = await requireSessionUser();
  const { user, sid, mfa } = loaded;
  const key = `mfa-verify:${user.id}`;
  const h = await headers();
  try {
    await enforceSlidingWindowRateLimit(key, VERIFY_MAX_PER_USER, WINDOW_MS, TOO_MANY);
    const { credential } = await verifyAuthentication({
      challengeId: input.challengeId,
      response: input.response,
      purpose: "authenticate",
      expectedUserId: user.id,
    });
    await clearRateLimit(key);
    await setMfaVerifiedCookie({ userId: user.id, sid, method: "passkey" });
    await recordAuditLog(prisma, {
      userId: user.id,
      action: mfa.verified ? AUDIT_ACTIONS.mfa_step_up : AUDIT_ACTIONS.mfa_verified,
      targetType: "webauthn_credential",
      targetId: credential.id,
      metadata: { method: "passkey" },
      headers: h,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof MfaVerificationError) {
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.mfa_verification_failed,
        metadata: { method: "passkey" },
        headers: h,
      });
    }
    return failure(err, "Passkey verification failed.");
  }
}

/**
 * Recovery codes satisfy the wall *and* count as step-up for a few minutes — otherwise a
 * user who lost their only passkey could never reach the (step-up gated) button that
 * removes it and enrol a replacement.
 */
export async function redeemRecoveryCodeAction(input: { code: string }): Promise<SimpleMfaResult> {
  const parsed = recoveryCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid recovery code." };
  const loaded = await requireSessionUser();
  const { user, sid } = loaded;
  if (!loaded.mfa.required) return { ok: false, error: "This account has no passkeys to recover." };

  const h = await headers();
  try {
    await enforceSlidingWindowRateLimit(`recovery:${user.id}`, RECOVERY_MAX, WINDOW_MS, TOO_MANY);
    const ip = clientMetaFromHeaders(h).ipAddress;
    if (ip) await enforceSlidingWindowRateLimit(`recovery-ip:${ip}`, RECOVERY_MAX, WINDOW_MS, TOO_MANY);

    const redeemed = await redeemRecoveryCode(user.id, parsed.data.code);
    if (!redeemed) {
      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.mfa_verification_failed,
        metadata: { method: "recovery" },
        headers: h,
      });
      return { ok: false, error: "That recovery code is not valid or was already used." };
    }
    await clearRateLimit(`recovery:${user.id}`);
    await setMfaVerifiedCookie({ userId: user.id, sid, method: "recovery" });
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.recovery_code_used,
      headers: h,
    });
    return { ok: true };
  } catch (err) {
    return failure(err, "Recovery failed.");
  }
}

export const renamePasskeyAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const parsed = renamePasskeySchema.parse({
    passkeyId: getFormValue(formData, "passkeyId"),
    name: getFormValue(formData, "name"),
  });
  const updated = await prisma.webAuthnCredential.updateMany({
    where: { id: parsed.passkeyId, userId: user.id },
    data: { name: parsed.name },
  });
  if (updated.count !== 1) throw new Error("Passkey not found.");
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.passkey_renamed,
    targetType: "webauthn_credential",
    targetId: parsed.passkeyId,
    metadata: { name: parsed.name },
    headers: await headers(),
  });
  revalidatePath("/settings", "layout");
});

/** Removing the last passkey switches MFA off again (and burns the recovery codes with it). */
export const removePasskeyAction = formAction(async (formData: FormData) => {
  const loaded = await requireFreshMfa();
  const { user } = loaded;
  const parsed = passkeyRowIdSchema.parse({ passkeyId: getFormValue(formData, "passkeyId") });

  const existing = await prisma.webAuthnCredential.findFirst({
    where: { id: parsed.passkeyId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!existing) throw new Error("Passkey not found.");

  const last = loaded.mfa.passkeyCount <= 1;
  if (last && !user.passwordHash) {
    const ssoLinks = await prisma.authAccount.count({ where: { userId: user.id } });
    if (ssoLinks === 0) {
      throw new Error("This passkey is your only way to sign in. Set a password first (Forgot password on the login page).");
    }
  }

  await prisma.$transaction([
    prisma.webAuthnCredential.delete({ where: { id: existing.id } }),
    ...(last ? [prisma.recoveryCode.deleteMany({ where: { userId: user.id } })] : []),
  ]);
  if (last) await clearMfaCookie();

  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.passkey_removed,
    targetType: "webauthn_credential",
    targetId: existing.id,
    metadata: { name: existing.name },
    headers: h,
  });
  if (last) {
    await recordAuditLog(prisma, { userId: user.id, action: AUDIT_ACTIONS.mfa_disabled, headers: h });
  }
  revalidatePath("/settings", "layout");
});

export async function regenerateRecoveryCodesAction(): Promise<RecoveryCodesResult> {
  try {
    const { user } = await requireFreshMfa();
    const codes = await generateRecoveryCodes(user.id);
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.recovery_codes_generated,
      metadata: { count: codes.length, reason: "regenerated" },
      headers: await headers(),
    });
    revalidatePath("/settings", "layout");
    return { ok: true, codes };
  } catch (err) {
    return failure(err, "Could not generate recovery codes.");
  }
}

/** Anonymous: called from the login page before any session exists. */
export async function beginPasswordlessSignInAction(): Promise<BeginAuthenticationResult> {
  try {
    const ip = await clientIp();
    if (ip) await enforceSlidingWindowRateLimit(`passkey-signin-ip:${ip}`, PASSKEY_SIGNIN_MAX_PER_IP, WINDOW_MS, TOO_MANY);
    const { challengeId, options } = await createAuthenticationOptions("signin", null);
    return { ok: true, challengeId, options };
  } catch (err) {
    return failure(err, "Could not start passkey sign-in.");
  }
}

/**
 * Mints the intent that lets `linkOAuthUser` attach the provider to *this* user. The
 * client then submits NextAuth's normal sign-in form for the provider; the callback finds
 * the intent cookie and links instead of refusing.
 */
export async function beginSsoLinkAction(input: { provider: string }): Promise<SimpleMfaResult> {
  const parsed = ssoLinkProviderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown sign-in provider." };
  const provider = parsed.data.provider;
  try {
    const { user } = await requireFreshMfa();
    const available = provider === "google" ? await getGoogleProvider() : await getAuthentikProvider();
    if (!available) return { ok: false, error: "That sign-in provider is not enabled on this server." };

    const already = await prisma.authAccount.findFirst({ where: { userId: user.id, provider }, select: { id: true } });
    if (already) return { ok: false, error: "That provider is already linked to your account." };

    const nonce = randomBytes(24).toString("base64url");
    const { id: challengeId } = await createChallenge("sso-link", user.id, nonce, SSO_LINK_MAX_AGE_S * 1000);
    await setSsoLinkCookie({ userId: user.id, provider, challengeId, exp: Date.now() + SSO_LINK_MAX_AGE_S * 1000 });
    await recordAuditLog(prisma, {
      userId: user.id,
      action: AUDIT_ACTIONS.sso_link_started,
      metadata: { provider },
      headers: await headers(),
    });
    return { ok: true };
  } catch (err) {
    return failure(err, "Could not start linking.");
  }
}

export const unlinkSsoProviderAction = formAction(async (formData: FormData) => {
  const loaded = await requireFreshMfa();
  const { user } = loaded;
  const { provider } = ssoLinkProviderSchema.parse({ provider: getFormValue(formData, "provider") });

  const links = await prisma.authAccount.findMany({ where: { userId: user.id }, select: { id: true, provider: true } });
  const target = links.filter((l) => l.provider === provider);
  if (target.length === 0) throw new Error("That provider is not linked.");
  if (!user.passwordHash && links.length === target.length && loaded.mfa.passkeyCount === 0) {
    throw new Error("Set a password before unlinking your only sign-in method.");
  }

  await prisma.authAccount.deleteMany({ where: { userId: user.id, provider } });
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.sso_account_unlinked,
    targetType: "auth_account",
    metadata: { provider },
    headers: await headers(),
  });
  revalidatePath("/settings", "layout");
});
