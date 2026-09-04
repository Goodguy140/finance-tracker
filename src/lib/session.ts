import type { Session } from "next-auth";
import type { User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export type ApiAuth = { status: "ok"; user: User } | { status: 401 };
export type AdminApiAuth = ApiAuth | { status: 403 };

/**
 * Sessions are stateless JWTs, so the only way to revoke one is to reject it on use.
 * Every entry point below already loads the user row, so comparing the version the token
 * was issued with against the current one costs nothing extra. A password change, reset,
 * or sign-out-everywhere bumps `User.tokenVersion` and every older token stops here.
 *
 * Tokens issued before the column existed carry no version and are read as 0, which
 * matches the column default — deploying this does not sign existing sessions out.
 */
function tokenVersionMatches(session: Session, user: User): boolean {
  return (session.user?.tokenVersion ?? 0) === user.tokenVersion;
}

/** For route handlers: returns the signed-in user or 401 (no redirects). */
export async function requireUserApiUser(): Promise<ApiAuth> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { status: 401 };
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { status: 401 };
  if (!tokenVersionMatches(session, user)) return { status: 401 };
  return { status: "ok", user };
}

/** For route handlers: returns admin user or an HTTP status code (no redirects). */
export async function requireAdminApiUser(): Promise<AdminApiAuth> {
  const auth = await requireUserApiUser();
  if (auth.status !== "ok") return auth;
  if (auth.user.role !== UserRole.SERVER_ADMIN) return { status: 403 };
  return auth;
}

export async function getCurrentSession() {
  return getServerSession(await getAuthOptions());
}

export async function requireUser() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");
  if (!tokenVersionMatches(session, user)) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== UserRole.SERVER_ADMIN) redirect("/settings");
  return user;
}
