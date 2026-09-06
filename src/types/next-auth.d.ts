import "next-auth";

type MfaSignInClaim = {
  /** Epoch ms of the passkey assertion that established this session. */
  at: number;
  method: "passkey";
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      role?: "SERVER_ADMIN" | "USER";
      /** Session-revocation counter carried from `User.tokenVersion` at sign-in. */
      tokenVersion?: number;
      /** Random id minted at sign-in; the MFA cookie is bound to it. */
      sid?: string;
      /** Epoch ms of the sign-in that established this session (absent on tokens issued before the claim existed). */
      authAt?: number;
      /** Present only when the session was established by a passwordless passkey sign-in. */
      mfa?: MfaSignInClaim;
    };
  }

  interface User {
    /** Set by the `passkey` credentials provider so the jwt callback can stamp `mfa`. */
    mfaVerifiedAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "SERVER_ADMIN" | "USER";
    /** Stamped once at sign-in and never refreshed — see `getAuthOptions`. */
    tokenVersion?: number;
    /** Stamped once at sign-in. NextAuth rotates `jti` on every re-encode, so it cannot serve as a login id. */
    sid?: string;
    /** Stamped once at sign-in and never refreshed. */
    authAt?: number;
    mfa?: MfaSignInClaim;
  }
}
