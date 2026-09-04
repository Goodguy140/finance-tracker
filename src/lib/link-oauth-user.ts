import type { Account, User } from "next-auth";
import { prisma } from "@/lib/prisma";

function publicSignupAllowed() {
  const value = process.env.ALLOW_PUBLIC_SIGNUP?.trim().toLowerCase();
  if (value === undefined) {
    return process.env.NODE_ENV !== "production";
  }
  return value === "true" || value === "1";
}

/** Link an OAuth sign-in (Google, Authentik, etc.) to a local user row. */
export async function linkOAuthUser(params: {
  user: User;
  account: Account;
  defaultDisplayName: string;
}) {
  const { user, account, defaultDisplayName } = params;
  if (!user.email || !account.providerAccountId) return false;

  const email = user.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing && !publicSignupAllowed()) {
    return false;
  }

  const currentCount = existing ? 1 : await prisma.user.count();
  const dbUser =
    existing ??
    (await prisma.user.create({
      data: {
        email,
        displayName: user.name?.trim() || defaultDisplayName,
        role: currentCount === 0 ? "SERVER_ADMIN" : "USER",
        emailVerifiedAt: new Date(),
      },
    }));

  // The provider's access/refresh/id tokens are deliberately not persisted. Nothing in
  // this app ever reads them back — sign-in state lives in the session JWT — so storing
  // them only created a set of live third-party credentials sitting in plaintext columns.
  // If a feature ever needs one (token refresh, calling a provider API), reintroduce it
  // through encryptSecret rather than restoring these assignments.
  await prisma.authAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    },
    update: {
      userId: dbUser.id,
      expiresAt: account.expires_at,
    },
    create: {
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      userId: dbUser.id,
      expiresAt: account.expires_at,
    },
  });

  return true;
}

export const OAUTH_ACCOUNT_PROVIDERS = ["google", "authentik"] as const;
export type OAuthAccountProvider = (typeof OAUTH_ACCOUNT_PROVIDERS)[number];

export function isOAuthAccountProvider(provider: string | undefined): provider is OAuthAccountProvider {
  return OAUTH_ACCOUNT_PROVIDERS.includes(provider as OAuthAccountProvider);
}
