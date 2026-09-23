import Link from "next/link";
import { AdminAuditFilters } from "@/components/admin-audit-filters";
import { AdminAuditTable } from "@/components/admin-audit-table";
import { AdminPageHeader, AdminSection } from "@/components/admin/ui";
import {
  listAuditActionsInUse,
  parseAuditLogSearchParams,
  queryAuditLog,
} from "@/lib/admin-audit-query";
import { effectiveAuditRetentionDays } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Carries the active filter onto the export and the pager, minus the page number. */
function filterQuery(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["action", "actor", "from", "to"]) {
    const value = Array.isArray(sp[key]) ? sp[key][0] : sp[key];
    if (value) query.set(key, value);
  }
  return query;
}

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseAuditLogSearchParams(sp);

  const [page, actions, retentionDays] = await Promise.all([
    queryAuditLog(prisma, filters),
    listAuditActionsInUse(prisma),
    effectiveAuditRetentionDays(prisma),
  ]);

  const base = filterQuery(sp);
  const exportQuery = base.toString();
  const pageHref = (n: number) => {
    const query = new URLSearchParams(base);
    if (n > 1) query.set("page", String(n));
    const s = query.toString();
    return s ? `/settings/admin/audit?${s}` : "/settings/admin/audit";
  };

  return (
    <>
      <AdminPageHeader
        title="Audit log"
        description={
          <>
            Every sign-in, admin change and API read. Entries are kept for {retentionDays} days, then
            pruned automatically (change this under{" "}
            <Link href="/settings/admin/operations" className="text-blue-300 underline hover:text-blue-200">
              Operations
            </Link>
            ).
          </>
        }
      />

      <AdminSection
        title="Search"
        description="The table shows metadata keys; the CSV export carries the full values."
      >
        <AdminAuditFilters
          filters={filters}
          actions={actions}
          exportHref={exportQuery ? `/api/admin/audit/export?${exportQuery}` : "/api/admin/audit/export"}
        />

        <p className="text-xs text-slate-500">
          {page.total.toLocaleString()} matching event{page.total === 1 ? "" : "s"} · page {page.page}{" "}
          of {page.pageCount}
        </p>
        <AdminAuditTable rows={page.rows} showClient />

        {page.pageCount > 1 ? (
          <div className="flex items-center gap-3 text-sm">
            {page.page > 1 ? (
              <Link href={pageHref(page.page - 1)} className="text-blue-300 underline hover:text-blue-200">
                ← Newer
              </Link>
            ) : (
              <span className="text-slate-600">← Newer</span>
            )}
            {page.page < page.pageCount ? (
              <Link href={pageHref(page.page + 1)} className="text-blue-300 underline hover:text-blue-200">
                Older →
              </Link>
            ) : (
              <span className="text-slate-600">Older →</span>
            )}
          </div>
        ) : null}
      </AdminSection>
    </>
  );
}
