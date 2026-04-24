import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

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
  if (user.role !== "SERVER_ADMIN") redirect("/settings");
  return user;
}
