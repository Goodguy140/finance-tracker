import { AdminUserTable } from "@/components/admin-user-table";
import { AdminPageHeader, AdminSection, StatTile } from "@/components/admin/ui";
import { listLastSignIns, listUsersForAdmin } from "@/lib/admin-users";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  const [{ users, adminCount }, lastSignIns] = await Promise.all([
    listUsersForAdmin(prisma),
    listLastSignIns(prisma),
  ]);
  const rows = users.map((user) => ({ ...user, lastSignInAt: lastSignIns.get(user.id) ?? null }));

  const suspended = users.filter((u) => u.disabledAt !== null).length;
  const withPasskey = users.filter((u) => u.passkeyCount > 0).length;
  const withSso = users.filter((u) => u.ssoProviders.length > 0).length;

  return (
    <>
      <AdminPageHeader
        title="Users"
        description="Review who has access, change roles, suspend or remove accounts, and end sessions."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Accounts" value={users.length} detail={`${suspended} suspended`} />
        <StatTile
          label="Active admins"
          value={adminCount}
          tone={adminCount <= 1 ? "warn" : "neutral"}
          detail={adminCount <= 1 ? "Consider a second admin" : "Able to sign in"}
        />
        <StatTile
          label="Passkey adoption"
          value={users.length ? `${Math.round((withPasskey / users.length) * 100)}%` : "—"}
          detail={`${withPasskey} of ${users.length} accounts`}
        />
        <StatTile label="Single sign-on" value={withSso} detail="accounts with a linked provider" />
      </div>

      <AdminSection
        title="Accounts"
        description={
          <>
            Suspending keeps an account&apos;s financial history but ends its sessions and disables its API
            tokens; deleting removes everything and cannot be undone. Activity shows counts only.
          </>
        }
      >
        <AdminUserTable users={rows} currentUserId={admin.id} />
        <p className="text-xs text-slate-500">
          Role changes take up to five minutes to reach an open session. Suspending and signing out take
          effect on the next request. Last sign-in comes from the audit log, so it is unknown beyond the
          retention window.
        </p>
      </AdminSection>
    </>
  );
}
