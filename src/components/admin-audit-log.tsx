import Link from "next/link";
import { AdminAuditTable } from "@/components/admin-audit-table";
import { queryAuditLog, type AuditLogPage } from "@/lib/admin-audit-query";
import { prisma } from "@/lib/prisma";

const PREVIEW_ROWS = 10;

/**
 * A short preview on the admin dashboard. Filtering, paging and export live on
 * /settings/admin/audit — this only answers "is anything happening right now".
 */
export async function AdminAuditLog() {
  const page: AuditLogPage = await queryAuditLog(
    prisma,
    { action: null, actor: null, from: null, to: null, page: 1 },
    PREVIEW_ROWS,
  );

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="font-semibold text-slate-100">Audit log</h2>
      <p className="text-xs text-slate-500">
        {page.total.toLocaleString()} event{page.total === 1 ? "" : "s"} recorded; newest{" "}
        {Math.min(PREVIEW_ROWS, page.rows.length)} shown (metadata is scrubbed server-side).
      </p>
      <AdminAuditTable rows={page.rows} />
      <Link
        href="/settings/admin/audit"
        className="inline-flex rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
      >
        Search and export
      </Link>
    </section>
  );
}
