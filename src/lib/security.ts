import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const base = process.env.SERVER_SETTINGS_ENCRYPTION_KEY;
  if (!base && process.env.NODE_ENV === "production") {
    throw new Error("Missing required env var SERVER_SETTINGS_ENCRYPTION_KEY in production.");
  }
  const resolved = base ?? "dev-only-key-change-me";
  if (process.env.NODE_ENV === "production" && resolved.length < 32) {
    throw new Error("SERVER_SETTINGS_ENCRYPTION_KEY must be at least 32 characters in production.");
  }
  return crypto.createHash("sha256").update(resolved).digest();
}

export function encryptSecret(plainText: string) {
  const iv = crypto.randomBytes(16);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string) {
  const [ivHex, authTagHex, encryptedHex] = payload.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) return "";
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * `decryptSecret` throws when the GCM auth tag does not verify — which is exactly what
 * happens to every stored value after SERVER_SETTINGS_ENCRYPTION_KEY is rotated. Callers
 * that render stored settings should use this and show "could not be decrypted" instead
 * of turning a key rotation into an unexplained 500.
 */
export function tryDecryptSecret(payload: string): string | null {
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}
