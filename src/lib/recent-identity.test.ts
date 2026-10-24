import { describe, expect, it } from "vitest";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import { identityConfirmedAt, identityFreshUntil, identityMethodFor } from "./recent-identity";

const now = Date.UTC(2026, 9, 24, 12);
const minutesAgo = (m: number) => now - m * 60_000;
const fresh = (at: number | null) => {
  const until = identityFreshUntil(at);
  return until != null && now <= until;
};

describe("identityMethodFor", () => {
  it("asks for the strongest thing the account has", () => {
    const mfa = (required: boolean) => ({ required, verified: false, verifiedAt: null, method: null, passkeyCount: 0 });
    expect(identityMethodFor({ mfa: mfa(true), user: { passwordHash: "h" } })).toBe("passkey");
    expect(identityMethodFor({ mfa: mfa(false), user: { passwordHash: "h" } })).toBe("password");
    expect(identityMethodFor({ mfa: mfa(false), user: { passwordHash: null } })).toBe("sso");
  });
});

describe("identityConfirmedAt", () => {
  it("does not let a re-entered password stand in for a passkey", () => {
    const at = identityConfirmedAt({ method: "passkey", mfaVerifiedAt: minutesAgo(60), authAt: minutesAgo(1), reauthAt: minutesAgo(1) });
    expect(fresh(at)).toBe(false);
  });

  it("accepts a recent passkey assertion", () => {
    expect(fresh(identityConfirmedAt({ method: "passkey", mfaVerifiedAt: minutesAgo(1), authAt: null, reauthAt: null }))).toBe(true);
  });

  it("needs the password again once the sign-in is old, and honours it for the window", () => {
    expect(fresh(identityConfirmedAt({ method: "password", mfaVerifiedAt: null, authAt: minutesAgo(90), reauthAt: null }))).toBe(false);
    expect(fresh(identityConfirmedAt({ method: "password", mfaVerifiedAt: null, authAt: minutesAgo(90), reauthAt: minutesAgo(1) }))).toBe(true);
    const lapsed = minutesAgo(MFA_STEP_UP_MAX_AGE_MS / 60_000 + 1);
    expect(fresh(identityConfirmedAt({ method: "password", mfaVerifiedAt: null, authAt: null, reauthAt: lapsed }))).toBe(false);
  });

  it("only counts a recent sign-in for SSO accounts, never a stray password cookie", () => {
    expect(fresh(identityConfirmedAt({ method: "sso", mfaVerifiedAt: null, authAt: minutesAgo(2), reauthAt: null }))).toBe(true);
    expect(fresh(identityConfirmedAt({ method: "sso", mfaVerifiedAt: null, authAt: minutesAgo(90), reauthAt: minutesAgo(1) }))).toBe(false);
  });
});
