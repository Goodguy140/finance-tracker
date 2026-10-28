import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, matchTotp, otpauthUrl, qrSvg, totpCode, totpStep } from "./totp";

// RFC 6238 Appendix B (SHA-1): the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 4226 and RFC 6238 test values", () => {
    expect(hotp(Buffer.from("12345678901234567890"), 0)).toBe("755224");
    expect(hotp(Buffer.from("12345678901234567890"), 9)).toBe("520489");
    expect(totpCode(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(totpCode(RFC_SECRET, 1_111_111_109_000, 8)).toBe("07081804");
    expect(totpCode(RFC_SECRET, 20_000_000_000_000, 8)).toBe("65353130");
  });

  it("round-trips base32 the way authenticator apps write it", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb oi").toString()).toBe("foobar");
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it("accepts this step and one either side, nothing further, and never a step already used", () => {
    const secret = generateTotpSecret();
    const now = Date.UTC(2026, 9, 28, 12, 0, 10);
    const step = totpStep(now);
    expect(matchTotp(secret, totpCode(secret, now), now, null)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, now - 30_000), now, null)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, now + 30_000), now, null)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, now - 60_000), now, null)).toBeNull();
    // Replay: the code that just worked is refused once its step is recorded.
    expect(matchTotp(secret, totpCode(secret, now), now, step)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, now + 30_000), now, step)).toBe(step + 1);
    expect(matchTotp(secret, "12345", now, null)).toBeNull();
    expect(matchTotp(secret, "abcdef", now, null)).toBeNull();
  });

  it("builds the link and QR code an app scans", () => {
    const url = otpauthUrl("JBSWY3DPEHPK3PXP", "me@example.test", "Finance Tracker");
    expect(url).toBe(
      "otpauth://totp/Finance%20Tracker%3Ame%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Finance+Tracker&algorithm=SHA1&digits=6&period=30",
    );
    expect(qrSvg(url)).toMatch(/^<svg[^>]*viewBox/);
  });
});
