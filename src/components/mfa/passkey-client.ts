"use client";

import { useCallback, useState } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import {
  beginPasskeyAuthenticationAction,
  beginPasskeyRegistrationAction,
  finishPasskeyAuthenticationAction,
  finishPasskeyRegistrationAction,
} from "@/app/actions/mfa";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import type { MfaStepUpCode } from "@/lib/session";

export type PasskeyOutcome =
  | { ok: true }
  | { ok: false; cancelled: boolean; error: string; code?: MfaStepUpCode };

export function describeWebAuthnError(err: unknown): { cancelled: boolean; message: string } {
  if (!browserSupportsWebAuthn()) {
    return { cancelled: false, message: "This browser does not support passkeys." };
  }
  const name = err instanceof WebAuthnError ? err.name : err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
      return { cancelled: true, message: "The passkey prompt was cancelled or timed out." };
    case "InvalidStateError":
      return { cancelled: false, message: "This device already holds a passkey for your account." };
    case "SecurityError":
      return {
        cancelled: false,
        message: "Passkeys are unavailable on this address. Open the app at its configured hostname (HTTPS, or localhost).",
      };
    case "NotSupportedError":
      return { cancelled: false, message: "This device cannot create the kind of passkey required." };
    default:
      return { cancelled: false, message: err instanceof Error && err.message ? err.message : "Passkey operation failed." };
  }
}

/** One full assertion against the current login: sets the server-side verified cookie. */
export async function verifyWithPasskey(): Promise<PasskeyOutcome> {
  const begin = await beginPasskeyAuthenticationAction();
  if (!begin.ok) return { ok: false, cancelled: false, error: begin.error, code: begin.code };
  let response;
  try {
    response = await startAuthentication({ optionsJSON: begin.options });
  } catch (err) {
    const { cancelled, message } = describeWebAuthnError(err);
    return { ok: false, cancelled, error: message };
  }
  const finish = await finishPasskeyAuthenticationAction({ challengeId: begin.challengeId, response });
  if (!finish.ok) return { ok: false, cancelled: false, error: finish.error, code: finish.code };
  return { ok: true };
}

export type RegisterOutcome =
  | { ok: true; recoveryCodes: string[] | null }
  | { ok: false; cancelled: boolean; error: string; code?: MfaStepUpCode };

export async function registerPasskey(input: { name: string; currentPassword?: string }): Promise<RegisterOutcome> {
  const begin = await beginPasskeyRegistrationAction(input);
  if (!begin.ok) return { ok: false, cancelled: false, error: begin.error, code: begin.code };
  let response;
  try {
    response = await startRegistration({ optionsJSON: begin.options });
  } catch (err) {
    const { cancelled, message } = describeWebAuthnError(err);
    return { ok: false, cancelled, error: message };
  }
  const finish = await finishPasskeyRegistrationAction({ challengeId: begin.challengeId, response, name: input.name });
  if (!finish.ok) return { ok: false, cancelled: false, error: finish.error, code: finish.code };
  return { ok: true, recoveryCodes: finish.recoveryCodes };
}

/**
 * Step-up gate for the client. `freshUntil` is the server's view when the page rendered;
 * a successful prompt extends it locally so several gated actions in a row need one prompt.
 */
export function usePasskeyStepUp(initialFreshUntil: number | null, enrolled: boolean) {
  const [localFreshUntil, setFreshUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Whichever is newer: the server's view at render time, or a prompt passed since.
  const freshUntil = Math.max(initialFreshUntil ?? 0, localFreshUntil ?? 0) || null;
  const isFresh = useCallback(() => freshUntil != null && Date.now() < freshUntil - 5_000, [freshUntil]);

  const ensureFresh = useCallback(async (): Promise<PasskeyOutcome> => {
    if (!enrolled) {
      return {
        ok: false,
        cancelled: false,
        code: "mfa_required",
        error: "Add a passkey in Settings → Security before linking external accounts.",
      };
    }
    if (isFresh()) return { ok: true };
    setBusy(true);
    try {
      const outcome = await verifyWithPasskey();
      if (outcome.ok) setFreshUntil(Date.now() + MFA_STEP_UP_MAX_AGE_MS);
      return outcome;
    } finally {
      setBusy(false);
    }
  }, [enrolled, isFresh]);

  return { ensureFresh, isFresh, busy, enrolled };
}
