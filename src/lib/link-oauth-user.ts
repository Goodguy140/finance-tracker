import type { Account, User } from "next-auth";
import { cookies } from "next/headers";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { clearSsoLinkCookie, readSsoLinkIntent, ssoLinkCookieName } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { publicSignupAllowed, resolveSignupRole } from "@/lib/signup-policy";
import { consumeChallenge } from "@/lib/webauthn";

/** Login page error code shown when an SSO identity matches an account it is not linked to. */
export const LINK_REQUIRED_ERROR = "LinkRequired";

/** NextAuth honours a relative redirect, but behind a tunnel the public origin is safer. */
function absoluteRedirect(path: string): string {
  const base = process.env.NEXTAUTH_URL?.trim();
  if (!base) return path;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/**
 * Make the session identity the local account, not the provider profile. The same object
 * is handed to the `jwt` callback, which keys the token on `user.id`.
 */
function adoptLocalIdentity(user: User, local: { id: string; email: string; displayName: string }) {
  user.id = local.id;
  user.email = local.email;
  user.name = local.displayName;
}

async function readLinkIntent() {
  try {
    const store = await cookies();
    return readSsoLinkIntent(store.get(ssoLinkCookieName())?.value);
  } catch {
    return null;
  }
}

/**
 * Resolve an OAuth sign-in (Google, Authentik, etc.) to a local user row.
 *
 * Returns `true` to let NextAuth issue a session, a URL string to redirect *without* a
 * session, or `false` to deny. Order matters:
 *
 * 1. Already linked → sign in as the linked account, whatever email the profile carries.
 * 2. A link intent minted by `beginSsoLinkAction` (which required a fresh passkey) → attach
 *    the provider to *that* user and bounce back to Settings. No new session is issued, so
 *    the user's current login and its passkey cookie stay intact.
 * 3. The profile email belongs to an existing account → refuse. Auto-linking by email used
 *    to happen here, which let anyone who controlled the mailbox at the provider take over
 *    the local account.
 * 4. Nobody has the email → create an account, if public sign-up is open.
 */
export async function linkOAuthUser(params: {
  user: User;
  account: Account;
  defaultDisplayName: string;
}): Promise<boolean | string> {
  const { user, account, defaultDisplayName } = params;
  const providerAccountId = account.providerAccountId;
  if (!providerAccountId) return false;
  const provider = account.provider;

  const linked = await prisma.authAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  if (linked) {
    await prisma.authAccount.update({ where: { id: linked.id }, data: { expiresAt: account.expires_at } });
    adoptLocalIdentity(user, linked.user);
    return true;
  }

  const intent = await readLinkIntent();
  if (intent && intent.provider === provider) {
    const nonce = await consumeChallenge(intent.challengeId, "sso-link", intent.userId);
    await clearSsoLinkCookie();
    const owner = nonce ? await prisma.user.findUnique({ where: { id: intent.userId } }) : null;
    if (owner) {
      await prisma.authAccount.create({
        data: { provider, providerAccountId, userId: owner.id, expiresAt: account.expires_at },
      });
      await recordAuditLog(prisma, {
        userId: owner.id,
        action: AUDIT_ACTIONS.sso_account_linked,
        targetType: "auth_account",
        metadata: { provider },
      });
      return absoluteRedirect(`/settings/security?linked=${encodeURIComponent(provider)}`);
    }
  }

  const email = user.email?.toLowerCase().trim();
  if (!email) return false;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await recordAuditLog(prisma, {
      userId: existing.id,
      action: AUDIT_ACTIONS.sso_link_rejected,
      metadata: { provider, reason: "email_match_without_link_intent" },
    });
    return absoluteRedirect(`/login?error=${LINK_REQUIRED_ERROR}`);
  }

  if (!(await publicSignupAllowed())) return false;

  // Same role rules as password signup (`INITIAL_ADMIN_EMAIL` included), and count +
  // create in one transaction so two first sign-ins cannot both become the admin.
  const dbUser = await prisma.$transaction(async (tx) => {
    const currentCount = await tx.user.count();
    const created = await tx.user.create({
      data: {
        email,
        displayName: user.name?.trim() || defaultDisplayName,
        role: resolveSignupRole(email, currentCount),
        emailVerifiedAt: new Date(),
      },
    });
    // The provider's access/refresh/id tokens are deliberately not persisted. Nothing in
    // this app ever reads them back — sign-in state lives in the session JWT — so storing
    // them only created a set of live third-party credentials sitting in plaintext columns.
    // If a feature ever needs one (token refresh, calling a provider API), reintroduce it
    // through encryptSecret rather than restoring these assignments.
    await tx.authAccount.create({
      data: { provider, providerAccountId, userId: created.id, expiresAt: account.expires_at },
    });
    return created;
  });
  adoptLocalIdentity(user, dbUser);
  return true;
}

export const OAUTH_ACCOUNT_PROVIDERS = ["google", "authentik"] as const;
export type OAuthAccountProvider = (typeof OAUTH_ACCOUNT_PROVIDERS)[number];

export function isOAuthAccountProvider(provider: string | undefined): provider is OAuthAccountProvider {
  return OAUTH_ACCOUNT_PROVIDERS.includes(provider as OAuthAccountProvider);
}
