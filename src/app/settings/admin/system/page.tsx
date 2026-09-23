import { AdminEnvConfigPanel } from "@/components/admin-env-config";
import { AdminMigrationHealthPanel } from "@/components/admin-migration-health";
import { AdminRuntimeMetricsPanel } from "@/components/admin-runtime-metrics";
import { AdminSystemHealthPanel } from "@/components/admin-system-health";
import { AdminPageHeader, AdminSection } from "@/components/admin/ui";
import { getAdminRuntimeMetrics } from "@/lib/admin-runtime-metrics";
import { getAdminStorageStats } from "@/lib/admin-analytics-series";
import { getAdminSystemHealth } from "@/lib/admin-system-health";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminSystemPage() {
  await requireAdmin();
  const [systemHealth, storage] = await Promise.all([getAdminSystemHealth(prisma), getAdminStorageStats(prisma)]);
  const runtime = getAdminRuntimeMetrics();
  const { schema, oauth, repair } = systemHealth.migrationHealth;
  const maxRows = Math.max(1, ...storage.map((s) => s.rows));

  return (
    <>
      <AdminPageHeader
        title="System"
        description="Health of this server process, its database and its configuration."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <AdminSystemHealthPanel health={systemHealth} />
        <AdminRuntimeMetricsPanel metrics={runtime} />
      </div>
      <AdminMigrationHealthPanel schema={schema} oauth={oauth} repair={repair} />
      <AdminSection title="Storage" description="Rows per table. Audit and staged rows are the ones that grow unattended.">
        <ul className="space-y-1.5 text-xs">
          {storage.map((row) => (
            <li key={row.table} className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-2">
              <span className="truncate text-slate-400">{row.table}</span>
              <span className="h-2 overflow-hidden rounded-full bg-slate-800" aria-hidden>
                <span
                  className="block h-full rounded-full bg-sky-500/80"
                  style={{ width: `${Math.max(1, (row.rows / maxRows) * 100)}%` }}
                />
              </span>
              <span className="text-right tabular-nums text-slate-200">{row.rows.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </AdminSection>
      <AdminEnvConfigPanel />
    </>
  );
}
