import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { NativePasskeyRegistration } from '@/utils/passkey-add';
import type { NativePasskeyAssertion } from '@/utils/passkey-sign-in';

/** `passkeys/Passkeys.swift`, an inline module built into the app. */
type PasskeysModule = {
  signIn(rpId: string, challengeBase64: string): Promise<NativePasskeyAssertion>;
  /** Missing in builds made before adding a passkey from the app existed. */
  register?(rpId: string, challengeBase64: string, userIdBase64: string, name: string, excludedBase64: string[]): Promise<NativePasskeyRegistration>;
};

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<PasskeysModule>('Passkeys') : null;

/** False in a build made before Face ID sign-in existed, or anywhere but iOS. */
export function passkeysAvailable(): boolean {
  return native !== null;
}

/** False in a build made before the app could add a passkey itself. */
export function addingPasskeysAvailable(): boolean {
  return typeof native?.register === 'function';
}

export type PasskeyResult =
  | { status: 'signed'; assertion: NativePasskeyAssertion }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

function failure(err: unknown): { status: 'failed'; error: string } {
  return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
}

const codeOf = (err: unknown) => (err as { code?: unknown } | null)?.code;

/** Shows iOS's passkey sheet for `rpId`, behind Face ID, and signs the challenge (standard base64). */
export async function signChallengeWithPasskey(rpId: string, challengeBase64: string): Promise<PasskeyResult> {
  if (!native) return { status: 'failed', error: 'This version of the app cannot use passkeys. Update it from TestFlight.' };
  try {
    return { status: 'signed', assertion: await native.signIn(rpId, challengeBase64) };
  } catch (err) {
    if (codeOf(err) === 'ERR_PASSKEY_CANCELLED') return { status: 'cancelled' };
    return failure(err);
  }
}

export type MadePasskey =
  | { status: 'made'; registration: NativePasskeyRegistration }
  | { status: 'cancelled' }
  | { status: 'exists' }
  | { status: 'failed'; error: string };

/** Shows iOS's sheet to save a new passkey for `rpId`, behind Face ID. Values are standard base64. */
export async function makePasskey(input: {
  rpId: string;
  challenge: string;
  userId: string;
  userName: string;
  excluded: string[];
}): Promise<MadePasskey> {
  if (!native?.register) return { status: 'failed', error: 'This version of the app cannot add passkeys. Update it from TestFlight.' };
  try {
    return { status: 'made', registration: await native.register(input.rpId, input.challenge, input.userId, input.userName, input.excluded) };
  } catch (err) {
    if (codeOf(err) === 'ERR_PASSKEY_CANCELLED') return { status: 'cancelled' };
    if (codeOf(err) === 'ERR_PASSKEY_EXISTS') return { status: 'exists' };
    return failure(err);
  }
}
