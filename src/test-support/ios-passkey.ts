import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

let seq = 0;

/** A P-256 key pair, the public half in COSE form as the server stores it. */
function p256Key() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const coseKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ]),
  );
  return { privateKey, coseKey };
}

/** An assertion for `challenge` signed with `privateKey`, as the app sends iOS's. */
function iosAssertion(input: { rpId: string; credentialId: string; userId: string; privateKey: KeyObject; challenge: string; origin?: string }) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: input.challenge, origin: input.origin ?? `https://${input.rpId}` }));
  const flags = 0x01 | 0x04 | 0x08 | 0x10; // user present, user verified, backup eligible, backed up
  const authenticatorData = Buffer.concat([createHash("sha256").update(input.rpId).digest(), Buffer.from([flags]), Buffer.alloc(4)]);
  const signed = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
  return {
    id: input.credentialId,
    rawId: input.credentialId,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
      authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
      signature: isoBase64URL.fromBuffer(sign("sha256", signed, input.privateKey)),
      userHandle: isoBase64URL.fromBuffer(new TextEncoder().encode(input.userId)),
    },
  };
}

/**
 * A passkey for `userId`, registered as the web's settings page stores one (a P-256 key in COSE
 * form), and `assert`, which answers a challenge the way the phone app sends iOS's assertion:
 * origin `https://<rp id>`, user present and verified, and a synced passkey's counter of 0.
 */
export async function registerIosPasskey(db: PrismaClient, userId: string, rpId: string) {
  seq += 1;
  const { privateKey, coseKey } = p256Key();
  const credentialId = isoBase64URL.fromBuffer(new TextEncoder().encode(`ios-credential-${userId}-${seq}`));
  await db.webAuthnCredential.create({
    data: {
      userId,
      credentialId,
      publicKey: isoBase64URL.fromBuffer(coseKey),
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      name: "iCloud Keychain",
    },
  });

  function assert(challenge: string, origin = `https://${rpId}`) {
    return iosAssertion({ rpId, credentialId, userId, privateKey, challenge, origin });
  }

  return { credentialId, assert };
}

/**
 * A new passkey made the way the phone app's `Passkeys.register` makes one: iOS's registration
 * for `options` (the server's creation options), with "none" attestation, user verified and
 * synced, as the app sends it. `assert` then signs in with it.
 */
export function makeIosPasskey(
  options: { challenge: string; rp: { id?: string }; user: { id: string } },
  origin?: string,
) {
  seq += 1;
  const rpId = options.rp.id!;
  const userId = new TextDecoder().decode(isoBase64URL.toBuffer(options.user.id));
  const { privateKey, coseKey } = p256Key();
  const rawId = new TextEncoder().encode(`ios-new-credential-${userId}-${seq}`);
  const credentialId = isoBase64URL.fromBuffer(rawId);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(rawId.length);
  const flags = 0x01 | 0x04 | 0x08 | 0x10 | 0x40; // present, verified, backup eligible, backed up, attested data
  const authData = Buffer.concat([
    createHash("sha256").update(rpId).digest(),
    Buffer.from([flags]),
    Buffer.alloc(4), // a synced passkey's counter
    Buffer.alloc(16), // AAGUID, all zeros with "none" attestation
    length,
    Buffer.from(rawId),
    Buffer.from(coseKey),
  ]);
  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", new Uint8Array(authData)],
    ]) as never,
  );
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: origin ?? `https://${rpId}` }));
  const response = {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
      attestationObject: isoBase64URL.fromBuffer(attestationObject),
      transports: ["internal", "hybrid"],
    },
  };
  return {
    credentialId,
    response,
    assert: (challenge: string) => iosAssertion({ rpId, credentialId, userId, privateKey, challenge }),
  };
}
