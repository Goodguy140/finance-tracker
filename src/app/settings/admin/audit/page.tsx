import Link from "next/link";
import { AdminAuditFilters } from "@/components/admin-audit-filters";
import { AdminAuditTable } from "@/components/admin-audit-table";
import {
  listAuditActionsInUse,
  parseAuditLogSearchParams,
  queryAuditLog,
} from "@/lib/admin-audit-query";
import { resolveAuditRetentionDays } from "@/lib/audit-log";
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

  const [page, actions] = await Promise.all([
    queryAuditLog(prisma, filters),
    listAuditActionsInUse(prisma),
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
    <main className="mx-auto my-8 max-w-5xl space-y-4 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <Link href="/settings/admin" className="text-blue-300 hover:text-blue-200 underline">
          Back to admin
        </Link>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="font-semibold text-slate-100">Search</h2>
        <p className="text-xs text-slate-500">
          Entries are kept for {resolveAuditRetentionDays()} days, then pruned automatically. The
          table shows metadata keys; the CSV export carries the full values.
        </p>
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
      </section>
    </main>
  );
}
