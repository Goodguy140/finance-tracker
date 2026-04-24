import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { decryptSecret } from "@/lib/security";
import { prisma } from "@/lib/prisma";

async function getServerSetting(key: string) {
  const row = await prisma.serverSetting.findUnique({ where: { key } });
  if (!row) return null;
  return decryptSecret(row.encryptedValue);
}

async function getGoogleProvider() {
  const [enabled, clientId, clientSecret] = await Promise.all([
    getServerSetting("oauth.google.enabled"),
    getServerSetting("oauth.google.clientId"),
    getServerSetting("oauth.google.clientSecret"),
  ]);

  if (enabled !== "true" || !clientId || !clientSecret) return null;
  return GoogleProvider({ clientId, clientSecret });
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const googleProvider = await getGoogleProvider();
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

  const providers = [credentialsProvider, ...(googleProvider ? [googleProvider] : [])];

  return {
    session: { strategy: "jwt" },
    providers,
    pages: {
      signIn: "/login",
    },
    callbacks: {
      async signIn({ user, account }) {
        if (!user.email) return false;
        if (account?.provider === "google") {
          const existing = await prisma.user.findUnique({
            where: { email: user.email.toLowerCase() },
          });
          const currentCount = existing ? 1 : await prisma.user.count();
          const dbUser =
            existing ??
            (await prisma.user.create({
              data: {
                email: user.email.toLowerCase(),
                displayName: user.name ?? "Google User",
                role: currentCount === 0 ? "SERVER_ADMIN" : "USER",
                emailVerifiedAt: new Date(),
              },
            }));

          await prisma.authAccount.upsert({
            where: {
              provider_providerAccountId: {
                provider: "google",
                providerAccountId: account.providerAccountId,
              },
            },
            update: { userId: dbUser.id },
            create: {
              provider: "google",
              providerAccountId: account.providerAccountId,
              userId: dbUser.id,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: account.expires_at,
            },
          });
        }
        return true;
      },
      async jwt({ token }) {
        const typedToken = token as JWT & { role?: "SERVER_ADMIN" | "USER" };
        if (token.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email.toLowerCase() },
            select: { id: true, role: true, displayName: true },
          });
          if (dbUser) {
            typedToken.sub = dbUser.id;
            typedToken.role = dbUser.role;
            typedToken.name = dbUser.displayName;
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
    secret: process.env.NEXTAUTH_SECRET,
  };
}
