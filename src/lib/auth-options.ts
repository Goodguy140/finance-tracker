import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { getAuthentikProvider, getGoogleProvider } from "@/lib/oauth-provider-config";
import { isOAuthAccountProvider, linkOAuthUser } from "@/lib/link-oauth-user";
import { prisma } from "@/lib/prisma";
import { clearRateLimit, enforceSlidingWindowRateLimit } from "@/lib/rate-limit";

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
const LOGIN_MAX_PER_IP = 30;
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

/** How long an issued session stays valid (seconds). */
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

type AppJwt = JWT & {
  role?: "SERVER_ADMIN" | "USER";
  roleRefreshedAt?: number;
  tokenVersion?: number;
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
          LOGIN_MAX_PER_IP,
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

  const providers = [
    credentialsProvider,
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
        if (!user.email) return false;
        if (isOAuthAccountProvider(account?.provider)) {
          return linkOAuthUser({
            user,
            account,
            defaultDisplayName: OAUTH_DEFAULT_NAMES[account.provider] ?? "SSO User",
          });
        }
        return true;
      },
      async jwt({ token, user }) {
        const typedToken = token as AppJwt;
        if (!token.email) return typedToken;

        // `user` is only populated on the request that establishes the session.
        const isSignIn = Boolean(user);
        const now = Date.now();
        const stale =
          isSignIn ||
          typedToken.roleRefreshedAt == null ||
          now - typedToken.roleRefreshedAt > ROLE_REFRESH_MS;

        if (stale) {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email.toLowerCase() },
            select: { id: true, role: true, displayName: true, tokenVersion: true },
          });
          if (dbUser) {
            typedToken.sub = dbUser.id;
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
        }
        return session;
      },
    },
    secret: getRequiredAuthSecret(),
  };
}
