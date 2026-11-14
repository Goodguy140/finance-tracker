import type { Me } from '@/api/types';
import { base64FromBase64Url, base64UrlFromBase64 } from '@/utils/base64url';
import { formatDate } from '@/utils/dates';

/**
 * The phone side of adding a passkey (`src/lib/app-passkeys.ts` in the web app). Pure functions
 * only; `src/session/add-passkey.ts` wires them to iOS and the network.
 *
 * The app confirms it's you first (Face ID with a passkey the account has, or a code from its
 * authenticator app), the server answers a registration challenge, iOS makes the passkey behind
 * Face ID, and the server checks and keeps it.
 */

export type PasskeyProof = 'face-id' | 'code';

export type AppPasskey = { id: string; name: string; createdAt: string; lastUsedAt: string | null; synced: boolean };

/** `GET /api/v1/app/passkeys`. */
export type AppPasskeys = { passkeys: AppPasskey[]; proof: PasskeyProof | null; appLinking: boolean };

/** Whether the server can list and add passkeys for the phone. */
export function hasPasskeys(me: Pick<Me, 'features'> | undefined): boolean {
  return me?.features?.includes('passkeys') ?? false;
}

/**
 * Whether this phone can add a passkey here, or why not. iOS makes passkeys only for the
 * server this build was made for, and only once that server names the app.
 */
export function addPasskeyReady(input: {
  nativeReady: boolean;
  homeServer: boolean;
  data: Pick<AppPasskeys, 'proof' | 'appLinking'>;
}): { ok: true; proof: PasskeyProof } | { ok: false; reason: string } {
  const { nativeReady, homeServer, data } = input;
  if (!homeServer) return { ok: false, reason: "This isn't the server this app was built for, so passkeys are added on the website, in Settings → Security." };
  if (!nativeReady) return { ok: false, reason: "This version of the app can't add passkeys. Update it from TestFlight, or use the website." };
  if (!data.appLinking) {
    return { ok: false, reason: "Your server isn't set up for this app's passkeys yet, so they're added on the website. An admin turns it on with APPLE_APP_ID." };
  }
  if (!data.proof) {
    return {
      ok: false,
      reason: 'Add your first passkey on the website, in Settings → Security. It asks for your password there, which this app never sees, and gives you recovery codes.',
    };
  }
  return { ok: true, proof: data.proof };
}

/** A passkey's name as the server keeps it: 1 to 40 characters. Null when there is nothing to keep. */
export function tidyPasskeyName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40).trim();
  return name || null;
}

/** An authenticator code as typed, spaces and all, down to its six digits; null until it is six. */
export function tidyCode(raw: string): string | null {
  const code = raw.replace(/\s/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

/** "Added Nov 14, 2026 · used Nov 20, 2026 · synced". */
export function passkeyLine(p: Pick<AppPasskey, 'createdAt' | 'lastUsedAt' | 'synced'>, locale?: string): string {
  const day = (iso: string) => formatDate(iso.slice(0, 10), locale);
  return [`Added ${day(p.createdAt)}`, p.lastUsedAt ? `used ${day(p.lastUsedAt)}` : 'not used yet', p.synced ? 'synced' : null]
    .filter(Boolean)
    .join(' · ');
}

/** What iOS needs from the server's creation options, in the standard base64 Swift reads. */
export type PasskeyCreation = {
  challengeId: string;
  rpId: string;
  challenge: string;
  userId: string;
  userName: string;
  excluded: string[];
};

/** `POST /api/v1/app/passkeys/options`: the challenge and creation options, base64url as written. */
export function readCreationOptions(body: unknown): PasskeyCreation | null {
  if (!body || typeof body !== 'object') return null;
  const { challengeId, options } = body as Record<string, unknown>;
  const o = (options ?? {}) as Record<string, unknown>;
  const rp = (o.rp ?? {}) as Record<string, unknown>;
  const user = (o.user ?? {}) as Record<string, unknown>;
  if (typeof challengeId !== 'string' || !challengeId) return null;
  if (typeof o.challenge !== 'string' || !o.challenge || typeof rp.id !== 'string' || !rp.id) return null;
  if (typeof user.id !== 'string' || !user.id || typeof user.name !== 'string') return null;
  const excluded = Array.isArray(o.excludeCredentials)
    ? o.excludeCredentials.flatMap((c) => (c && typeof (c as { id?: unknown }).id === 'string' ? [base64FromBase64Url((c as { id: string }).id)] : []))
    : [];
  return {
    challengeId,
    rpId: rp.id,
    challenge: base64FromBase64Url(o.challenge),
    userId: base64FromBase64Url(user.id),
    userName: user.name,
    excluded,
  };
}

/** What the `Passkeys` module hands back from iOS for a new passkey: each value standard base64. */
export type NativePasskeyRegistration = { credentialId: string; clientDataJSON: string; attestationObject: string };

/**
 * iOS's new passkey as the `RegistrationResponseJSON` the server verifies, as a browser would
 * send it: base64url throughout, made on this phone and usable from others nearby.
 */
export function registrationResponse(made: NativePasskeyRegistration) {
  const id = base64UrlFromBase64(made.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64UrlFromBase64(made.clientDataJSON),
      attestationObject: base64UrlFromBase64(made.attestationObject),
      transports: ['internal', 'hybrid'],
    },
  };
}
