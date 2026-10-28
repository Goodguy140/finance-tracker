import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import qrcode from "qrcode-generator";

/**
 * Authenticator-app codes (TOTP, RFC 6238): HMAC-SHA1, 6 digits, 30-second steps, the
 * parameters every authenticator app defaults to. Pure functions; storage and the session
 * side are in `totp-credentials.ts` and `actions/mfa.ts`.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of now that still count, for a phone clock a little off. */
const DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 160 bits, the size RFC 4226 recommends for SHA-1. Base32, as apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP for one counter value. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, "0");
}

export function totpStep(now: number): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secretBase32: string, now: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), totpStep(now), digits);
}

/**
 * The step `code` matches, within one step of now, or null. A step at or before
 * `lastUsedStep` is refused, so a code that was seen (over a shoulder, in a log) cannot be
 * replayed inside its 30 seconds.
 */
export function matchTotp(secretBase32: string, code: string, now: number, lastUsedStep: number | null): number | null {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(now);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(given))) return step;
  }
  return null;
}

/** The `otpauth://` link an authenticator app reads from the QR code. */
export function otpauthUrl(secretBase32: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The QR code for `text`, as SVG markup made on the server (no image request, no outside host). */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

/** Groups of four, so the secret can be typed into an app by hand. */
export function formatTotpSecret(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}
