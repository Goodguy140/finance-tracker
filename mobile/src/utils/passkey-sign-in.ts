import { base64UrlFromBase64 } from '@/utils/base64url';

/**
 * The phone side of Face ID sign-in (`src/lib/app-passkey-sign-in.ts` in the web app). Pure
 * functions only; `src/session/sign-in-with-server.ts` wires them to iOS and the network.
 *
 * The app asks the home server for a challenge, iOS signs it with the person's passkey for that
 * domain once Face ID passes, and the server trades the signature for this phone's token.
 */

export type PasskeySignInInfo = { optionsPath: string; tokenPath: string; rpId: string };

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

/** `passkeySignIn` in `GET /api/v1/server`: only a home server (`APPLE_APP_ID` set) sends it. */
export function readPasskeySignIn(body: unknown): PasskeySignInInfo | null {
  const block = (body as { passkeySignIn?: unknown } | null)?.passkeySignIn;
  if (!block || typeof block !== 'object') return null;
  const { optionsPath, tokenPath, rpId } = block as Record<string, unknown>;
  if (!isPath(optionsPath) || !isPath(tokenPath) || typeof rpId !== 'string' || !rpId) return null;
  return { optionsPath, tokenPath, rpId };
}

export type PasskeyChallenge = { challengeId: string; challenge: string; rpId: string };

/** `POST /api/v1/app/passkey/options`: the single-use challenge, base64url as the server wrote it. */
export function readPasskeyOptions(body: unknown): PasskeyChallenge | null {
  if (!body || typeof body !== 'object') return null;
  const { challengeId, options } = body as Record<string, unknown>;
  const { challenge, rpId } = (options ?? {}) as Record<string, unknown>;
  if (typeof challengeId !== 'string' || !challengeId) return null;
  if (typeof challenge !== 'string' || !challenge || typeof rpId !== 'string' || !rpId) return null;
  return { challengeId, challenge, rpId };
}

/** What the `Passkeys` module hands back from iOS: each value standard base64. */
export type NativePasskeyAssertion = {
  credentialId: string;
  userId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
};

/**
 * iOS's assertion as the `AuthenticationResponseJSON` the server verifies, exactly as a browser
 * would send it: base64url throughout, and no user handle when iOS returned none.
 */
export function authenticationResponse(assertion: NativePasskeyAssertion) {
  const id = base64UrlFromBase64(assertion.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64UrlFromBase64(assertion.clientDataJSON),
      authenticatorData: base64UrlFromBase64(assertion.authenticatorData),
      signature: base64UrlFromBase64(assertion.signature),
      ...(assertion.userId ? { userHandle: base64UrlFromBase64(assertion.userId) } : {}),
    },
  };
}

export function passkeyTokenRequestBody(input: {
  challengeId: string;
  assertion: NativePasskeyAssertion;
  deviceName: string;
  platform: string;
  appVersion: string | null;
}): string {
  return JSON.stringify({
    challengeId: input.challengeId,
    response: authenticationResponse(input.assertion),
    device_name: input.deviceName,
    platform: input.platform,
    ...(input.appVersion ? { app_version: input.appVersion } : {}),
  });
}
