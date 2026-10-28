"use client";

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
