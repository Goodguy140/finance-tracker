import { compare } from "bcryptjs";
import { randomUUID } from "crypto";
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { SESSION_MAX_AGE_S } from "@/lib/auth-constants";
import { getAuthentikProvider, getGoogleProvider } from "@/lib/oauth-provider-config";
import { isOAuthAccountProvider, linkOAuthUser } from "@/lib/link-oauth-user";
import { clearMfaCookie } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { clearRateLimit, enforceSlidingWindowRateLimit } from "@/lib/rate-limit";
import { verifyPasskeySignIn } from "@/lib/webauthn";

function getRequiredAuthSecret() {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("Missing required env var NEXTAUTH_SECRET in production.");
  }
  return secret;
}

const OAUTH_DEFAULT_NAMES: Record<string, string> = {
  google: "Google User",
  authentik: "SSO User",
};

/** Re-query role from DB at most once per this interval (ms). */
const ROLE_REFRESH_MS = 5 * 60 * 1000;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_EMAIL = 10;
/** Higher than the per-email budget: one address may host several legitimate users. */
const DEFAULT_LOGIN_MAX_PER_IP = 30;

/**
 * Per-IP login budget per window. Overridable because every client behind a shared NAT
 * (an office, a campus — or a test runner driving one server from one socket) presents
 * the same address; anything that is not a positive integer keeps the default.
 */
export function resolveLoginMaxPerIp(raw = process.env.LOGIN_MAX_PER_IP): number {
  const n = Number.parseInt(raw?.trim() ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOGIN_MAX_PER_IP;
}
/** Passkey sign-in has no email to key on; each attempt burns a single-use challenge anyway. */
const PASSKEY_MAX_PER_IP = 20;
const LOGIN_RATE_LIMIT_MESSAGE = "Too many login attempts. Please try again later.";

/** First hop of `x-forwarded-for`, falling back to `x-real-ip`. */
function clientIpFromRequestHeaders(headers: Record<string, unknown> | undefined) {
  if (!headers) return undefined;
  const read = (name: string) => {
    const raw = headers[name];
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
    return undefined;
  };
  const forwarded = read("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || read("x-real-ip")?.trim() || undefined;
}

type AppJwt = JWT & {
  role?: "SERVER_ADMIN" | "USER";
  roleRefreshedAt?: number;
  tokenVersion?: number;
  sid?: string;
  mfa?: { at: number; method: "passkey" };
};

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const [googleProvider, authentikProvider] = await Promise.all([
    getGoogleProvider(),
    getAuthentikProvider(),
  ]);

  const credentialsProvider = CredentialsProvider({
    name: "Email and Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials, req) {
      const email = credentials?.email?.toLowerCase().trim();
      const password = credentials?.password ?? "";
      if (!email || !password) return null;

      const emailKey = `login:${email}`;
      await enforceSlidingWindowRateLimit(
        emailKey,
        LOGIN_MAX_PER_EMAIL,
        LOGIN_WINDOW_MS,
        LOGIN_RATE_LIMIT_MESSAGE,
      );
      // Second dimension: the per-email budget alone does nothing against one password
      // sprayed across many addresses, since each address gets its own fresh counter.
      const ip = clientIpFromRequestHeaders(req?.headers);
      if (ip) {
        await enforceSlidingWindowRateLimit(
          `login-ip:${ip}`,
          resolveLoginMaxPerIp(),
          LOGIN_WINDOW_MS,
          LOGIN_RATE_LIMIT_MESSAGE,
        );
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return null;
      const valid = await compare(password, user.passwordHash);
      if (!valid) return null;

      // Honest sign-ins must not accumulate toward the lockout they are protected by.
      await clearRateLimit(emailKey);
      return {
        id: user.id,
        email: user.email,
        name: user.displayName,
        role: user.role,
      };
    },
  });

  /**
   * Passwordless first factor. The assertion is verified with user verification required,
   * so the session it produces already counts as passkey-verified (see the `jwt` callback).
   */
  const passkeyProvider = CredentialsProvider({
    id: "passkey",
    name: "Passkey",
    credentials: {
      challengeId: { label: "Challenge", type: "text" },
      response: { label: "Response", type: "text" },
    },
    async authorize(credentials, req) {
      const challengeId = credentials?.challengeId?.trim();
      const response = credentials?.response;
      if (!challengeId || !response) return null;

      const ip = clientIpFromRequestHeaders(req?.headers);
      if (ip) {
        await enforceSlidingWindowRateLimit(
          `passkey-ip:${ip}`,
          PASSKEY_MAX_PER_IP,
          LOGIN_WINDOW_MS,
          LOGIN_RATE_LIMIT_MESSAGE,
        );
      }

      const user = await verifyPasskeySignIn(challengeId, response);
      if (!user) return null;

      await recordAuditLog(prisma, {
        userId: user.id,
        action: AUDIT_ACTIONS.mfa_verified,
        metadata: { method: "passkey-signin" },
      });
      return {
        id: user.id,
        email: user.email,
        name: user.displayName,
        role: user.role,
        mfaVerifiedAt: Date.now(),
      };
    },
  });

  const providers = [
    credentialsProvider,
    passkeyProvider,
    ...(googleProvider ? [googleProvider] : []),
    ...(authentikProvider ? [authentikProvider] : []),
  ];

  return {
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
    providers,
    pages: {
      signIn: "/login",
    },
    callbacks: {
      async signIn({ user, account }) {
        if (isOAuthAccountProvider(account?.provider)) {
          return linkOAuthUser({
            user,
            account,
            defaultDisplayName: OAUTH_DEFAULT_NAMES[account.provider] ?? "SSO User",
          });
        }
        return Boolean(user.email);
      },
      async jwt({ token, user }) {
        const typedToken = token as AppJwt;

        // `user` is only populated on the request that establishes the session.
        const isSignIn = Boolean(user);
        if (isSignIn) {
          // A fresh id per login. NextAuth rotates `jti` on every re-encode, so this is
          // the only claim the passkey cookie can safely be bound to.
          typedToken.sid = randomUUID();
          if (typeof user.mfaVerifiedAt === "number") {
            typedToken.mfa = { at: user.mfaVerifiedAt, method: "passkey" };
          }
        }
        if (!token.email && !typedToken.sub) return typedToken;

        const now = Date.now();
        const stale =
          isSignIn ||
          typedToken.roleRefreshedAt == null ||
          now - typedToken.roleRefreshedAt > ROLE_REFRESH_MS;

        if (stale) {
          // Key on the local user id whenever we have one. `linkOAuthUser` rewrites
          // `user.id`/`user.email` to the *linked* local account, so an SSO identity with
          // a different email never resolves to whoever happens to own that address.
          const id = isSignIn ? user.id : typedToken.sub;
          const dbUser = await prisma.user.findUnique({
            where: id ? { id } : { email: token.email!.toLowerCase() },
            select: { id: true, email: true, role: true, displayName: true, tokenVersion: true },
          });
          if (dbUser) {
            typedToken.sub = dbUser.id;
            typedToken.email = dbUser.email;
            typedToken.role = dbUser.role;
            typedToken.name = dbUser.displayName;
            typedToken.roleRefreshedAt = now;
            // Stamped at sign-in only. Refreshing it on every role refresh would hand a
            // revoked token the current version back and silently re-validate it.
            if (isSignIn) typedToken.tokenVersion = dbUser.tokenVersion;
          }
        }
        return typedToken;
      },
      async session({ session, token }) {
        const typedToken = token as AppJwt;
        if (session.user) {
          session.user.id = typedToken.sub ?? "";
          session.user.role = typedToken.role ?? "USER";
          // Tokens issued before `User.tokenVersion` existed carry no version; treating
          // them as 0 matches the column default so an upgrade signs nobody out.
          session.user.tokenVersion = typedToken.tokenVersion ?? 0;
          session.user.sid = typedToken.sid;
          session.user.mfa = typedToken.mfa;
        }
        return session;
      },
    },
    events: {
      async signOut() {
        // Runs inside the sign-out route handler, where cookies are writable. The cookie
        // is bound to the login's `sid` and would be inert anyway; this just tidies up.
        try {
          await clearMfaCookie();
        } catch {
          /* not in a request scope that can set cookies */
        }
      },
    },
    secret: getRequiredAuthSecret(),
  };
}
