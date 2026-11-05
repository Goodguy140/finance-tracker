import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

let seq = 0;

/**
 * A passkey for `userId`, registered as the web's settings page stores one (a P-256 key in COSE
 * form), and `assert`, which answers a challenge the way the phone app sends iOS's assertion:
 * origin `https://<rp id>`, user present and verified, and a synced passkey's counter of 0.
 */
export async function registerIosPasskey(db: PrismaClient, userId: string, rpId: string) {
  seq += 1;
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
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin }));
    const flags = 0x01 | 0x04 | 0x08 | 0x10; // user present, user verified, backup eligible, backed up
    const authenticatorData = Buffer.concat([createHash("sha256").update(rpId).digest(), Buffer.from([flags]), Buffer.alloc(4)]);
    const signed = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
    return {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(sign("sha256", signed, privateKey)),
        userHandle: isoBase64URL.fromBuffer(new TextEncoder().encode(userId)),
      },
    };
  }

  return { credentialId, assert };
}
