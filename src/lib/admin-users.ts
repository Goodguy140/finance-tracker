import type { PrismaClient, UserRole } from "@prisma/client";

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  /** ISO timestamp when an admin suspended the account, or null while it is active. */
  disabledAt: string | null;
  createdAt: string;
  /** Provider ids this account can sign in through, e.g. ["google", "authentik"]. */
  ssoProviders: string[];
  passkeyCount: number;
  /** Personal access tokens that are neither revoked nor expired. */
  activeTokenCount: number;
  hasPassword: boolean;
};

export type AdminUserList = {
  users: AdminUserRow[];
  adminCount: number;
};

/**
 * Every user plus the things an access review actually asks about: how they can sign in,
 * whether they still hold machine credentials, and whether they are suspended.
 *
 * Takes `prisma` as a parameter rather than importing it so tests can pass a fake, matching
 * `getAdminAnalytics` and the other admin data functions.
 */
export async function listUsersForAdmin(prisma: PrismaClient): Promise<AdminUserList> {
  const now = new Date();
  const [rows, adminCount] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ disabledAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        disabledAt: true,
        createdAt: true,
        passwordHash: true,
        authAccounts: { select: { provider: true } },
        _count: { select: { webAuthnCredentials: true } },
        personalAccessTokens: {
          where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          select: { id: true },
        },
      },
    }),
    countActiveAdmins(prisma),
  ]);

  return {
    adminCount,
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      disabledAt: row.disabledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      ssoProviders: [...new Set(row.authAccounts.map((a) => a.provider))].sort(),
      passkeyCount: row._count.webAuthnCredentials,
      activeTokenCount: row.personalAccessTokens.length,
      hasPassword: row.passwordHash !== null,
    })),
  };
}

/**
 * Admins who can still sign in. A suspended admin cannot, so they must not count toward the
 * "last admin" guard — otherwise suspending one admin and then the other locks everyone out.
 */
export function countActiveAdmins(prisma: PrismaClient): Promise<number> {
  return prisma.user.count({ where: { role: "SERVER_ADMIN", disabledAt: null } });
}

export type AdminUserGuardTarget = {
  id: string;
  role: UserRole;
  disabledAt: Date | null;
};

/**
 * Refuses a change that would leave the server with no admin who can sign in, and refuses
 * any admin acting destructively on their own account.
 *
 * Returns the message to throw, or null when the change is allowed. Pure so the rules are
 * unit-testable without a database — the caller supplies the live admin count.
 */
export function describeUserMutationRefusal(params: {
  actorId: string;
  target: AdminUserGuardTarget;
  intent: "demote" | "disable" | "delete";
  activeAdminCount: number;
}): string | null {
  const { actorId, target, intent, activeAdminCount } = params;

  if (target.id === actorId) {
    const verb =
      intent === "demote" ? "change your own role" : intent === "disable" ? "suspend your own account" : "delete your own account";
    return `You cannot ${verb} here. Ask another server admin, or use Settings to delete your own account.`;
  }

  // Only a target who currently counts as an active admin can reduce the count.
  const targetCounts = target.role === "SERVER_ADMIN" && target.disabledAt === null;
  if (targetCounts && activeAdminCount <= 1) {
    return "This is the only server admin who can sign in. Promote another admin first.";
  }

  return null;
}
