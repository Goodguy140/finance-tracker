import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      role?: "SERVER_ADMIN" | "USER";
      /** Session-revocation counter carried from `User.tokenVersion` at sign-in. */
      tokenVersion?: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "SERVER_ADMIN" | "USER";
    /** Stamped once at sign-in and never refreshed — see `getAuthOptions`. */
    tokenVersion?: number;
  }
}
