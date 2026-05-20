import type { User } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export type ApiAuth = { status: "ok"; user: User } | { status: 401 };
export type AdminApiAuth = ApiAuth | { status: 403 };

/** For route handlers: returns the signed-in user or 401 (no redirects). */
export async function requireUserApiUser(): Promise<ApiAuth> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { status: 401 };
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { status: 401 };
  return { status: "ok", user };
}

/** For route handlers: returns admin user or an HTTP status code (no redirects). */
export async function requireAdminApiUser(): Promise<AdminApiAuth> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return { status: 401 };
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { status: 401 };
  if (user.role !== UserRole.SERVER_ADMIN) return { status: 403 };
  return { status: "ok", user };
}

export async function getCurrentSession() {
  return getServerSession(await getAuthOptions());
}

export async function requireUser() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== UserRole.SERVER_ADMIN) redirect("/settings");
  return user;
}
