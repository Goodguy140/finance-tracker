import Link from "next/link";
import { AdminUserTable } from "@/components/admin-user-table";
import { listUsersForAdmin } from "@/lib/admin-users";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  const { users, adminCount } = await listUsersForAdmin(prisma);

  return (
    <main className="mx-auto my-8 max-w-5xl space-y-4 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Link href="/settings/admin" className="text-blue-300 hover:text-blue-200 underline">
          Back to admin
        </Link>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="font-semibold text-slate-100">Accounts</h2>
        <p className="text-xs text-slate-500">
          {users.length} account{users.length === 1 ? "" : "s"}, {adminCount} able to sign in as
          server admin. Suspending keeps an account&apos;s financial history but ends its sessions and
          disables its API tokens; deleting removes everything and cannot be undone.
        </p>
        <AdminUserTable users={users} currentUserId={admin.id} />
        <p className="text-xs text-slate-500">
          Role changes take up to five minutes to reach an open session. Suspending and signing out
          take effect on the next request.
        </p>
      </section>
    </main>
  );
}
