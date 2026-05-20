import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { getAuthentikProvider, getGoogleProvider } from "@/lib/oauth-provider-config";
import { isOAuthAccountProvider, linkOAuthUser } from "@/lib/link-oauth-user";
import { prisma } from "@/lib/prisma";
import { enforceSlidingWindowRateLimit } from "@/lib/rate-limit";

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

type AppJwt = JWT & {
  role?: "SERVER_ADMIN" | "USER";
  roleRefreshedAt?: number;
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
    async authorize(credentials) {
      const email = credentials?.email?.toLowerCase().trim();
      const password = credentials?.password ?? "";
      if (!email || !password) return null;
      await enforceSlidingWindowRateLimit(
        `login:${email}`,
        10,
        15 * 60 * 1000,
        "Too many login attempts. Please try again later.",
      );
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return null;
      const valid = await compare(password, user.passwordHash);
      if (!valid) return null;
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
    session: { strategy: "jwt" },
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
      async jwt({ token }) {
        const typedToken = token as AppJwt;
        if (!token.email) return typedToken;

        const now = Date.now();
        const stale =
          typedToken.roleRefreshedAt == null || now - typedToken.roleRefreshedAt > ROLE_REFRESH_MS;

        if (stale) {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email.toLowerCase() },
            select: { id: true, role: true, displayName: true },
          });
          if (dbUser) {
            typedToken.sub = dbUser.id;
            typedToken.role = dbUser.role;
            typedToken.name = dbUser.displayName;
            typedToken.roleRefreshedAt = now;
          }
        }
        return typedToken;
      },
      async session({ session, token }) {
        const typedToken = token as JWT & { role?: "SERVER_ADMIN" | "USER" };
        if (session.user) {
          session.user.id = typedToken.sub ?? "";
          session.user.role = typedToken.role ?? "USER";
        }
        return session;
      },
    },
    secret: getRequiredAuthSecret(),
  };
}
