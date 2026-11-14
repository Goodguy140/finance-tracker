import { SignedOutError } from '@/api/client';
import { makePasskey } from '@/session/passkeys';
import { confirmWithFaceId, postAsApp } from '@/session/step-up';
import type { StoredSession } from '@/session/store';
import { readCreationOptions, registrationResponse, type AppPasskey, type PasskeyProof } from '@/utils/passkey-add';

export type AddPasskeyOutcome =
  | { status: 'added'; passkey: Pick<AppPasskey, 'id' | 'name'> }
  | { status: 'cancelled' }
  | { status: 'exists' }
  | { status: 'failed'; error: string };

/**
 * Adds a passkey from start to finish: confirm it's you (Face ID with a passkey the account has,
 * or the authenticator `code`), then the server's registration challenge, iOS's sheet to save the
 * new passkey, and the server keeping it under `name`.
 */
export async function addPasskey(
  session: StoredSession,
  input: { proof: PasskeyProof; code?: string; name: string },
): Promise<AddPasskeyOutcome> {
  try {
    let proof: object;
    if (input.proof === 'face-id') {
      const confirmed = await confirmWithFaceId(session);
      if (confirmed.status !== 'confirmed') return confirmed;
      proof = { stepUp: confirmed.stepUp };
    } else {
      proof = { code: input.code ?? '' };
    }

    const creation = readCreationOptions(await postAsApp(session, '/api/v1/app/passkeys/options', proof));
    if (!creation) return { status: 'failed', error: 'The server did not start the passkey. Try again.' };

    const made = await makePasskey(creation);
    if (made.status !== 'made') return made;

    const kept = (await postAsApp(session, '/api/v1/app/passkeys', {
      challengeId: creation.challengeId,
      response: registrationResponse(made.registration),
      name: input.name,
    })) as { passkey?: { id?: unknown; name?: unknown } } | null;
    const passkey = kept?.passkey;
    if (!passkey || typeof passkey.id !== 'string' || typeof passkey.name !== 'string') {
      return { status: 'failed', error: 'The server did not say whether it kept the passkey. Pull down to check.' };
    }
    return { status: 'added', passkey: { id: passkey.id, name: passkey.name } };
  } catch (err) {
    if (err instanceof SignedOutError) throw err;
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
