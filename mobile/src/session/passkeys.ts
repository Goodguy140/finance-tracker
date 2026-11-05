import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { NativePasskeyAssertion } from '@/utils/passkey-sign-in';

/** `passkeys/Passkeys.swift`, an inline module built into the app. */
type PasskeysModule = {
  signIn(rpId: string, challengeBase64: string): Promise<NativePasskeyAssertion>;
};

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<PasskeysModule>('Passkeys') : null;

/** False in a build made before Face ID sign-in existed, or anywhere but iOS. */
export function passkeysAvailable(): boolean {
  return native !== null;
}

export type PasskeyResult =
  | { status: 'signed'; assertion: NativePasskeyAssertion }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

/** Shows iOS's passkey sheet for `rpId`, behind Face ID, and signs the challenge (standard base64). */
export async function signChallengeWithPasskey(rpId: string, challengeBase64: string): Promise<PasskeyResult> {
  if (!native) return { status: 'failed', error: 'This version of the app cannot use passkeys. Update it from TestFlight.' };
  try {
    return { status: 'signed', assertion: await native.signIn(rpId, challengeBase64) };
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 'ERR_PASSKEY_CANCELLED') return { status: 'cancelled' };
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
