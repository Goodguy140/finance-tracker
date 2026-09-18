import type { AuditLogRow } from "@/lib/admin-audit-query";

/**
 * Metadata is shown as its keys, not its values. The values can contain an attempted email
 * address or other attacker-supplied text, and this table is dense enough already; the CSV
 * export is where the full values go.
 */
export function formatMetadata(json: string | null): string {
  if (!json) return "—";
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      return keys.length ? keys.join(", ") : "—";
    }
    return JSON.stringify(parsed).slice(0, 120);
  } catch {
    return json.slice(0, 120);
  }
}

export function formatAuditTimestamp(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 19)}Z`;
}

function targetLabel(row: AuditLogRow): string {
  return row.targetType || row.targetId ? [row.targetType, row.targetId].filter(Boolean).join(" ") : "—";
}

export function AdminAuditTable({ rows, showClient = false }: { rows: AuditLogRow[]; showClient?: boolean }) {
  const columns = showClient ? 6 : 5;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="min-w-full text-left text-xs text-slate-300">
        <thead className="bg-slate-950/80 text-slate-400">
          <tr>
            <th className="px-2 py-2 font-medium">Time</th>
            <th className="px-2 py-2 font-medium">Actor</th>
            <th className="px-2 py-2 font-medium">Action</th>
            <th className="px-2 py-2 font-medium">Target</th>
            <th className="px-2 py-2 font-medium">Metadata</th>
            {showClient ? <th className="px-2 py-2 font-medium">Client</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns} className="px-2 py-4 text-center text-slate-500">
                No audit entries match.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-800/80">
                <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                  {formatAuditTimestamp(row.createdAt)}
                </td>
                <td className="px-2 py-2">{row.actorEmail ?? "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-slate-200">{row.action}</td>
                <td className="max-w-[10rem] truncate px-2 py-2 font-mono text-[11px]">{targetLabel(row)}</td>
                <td className="max-w-[14rem] truncate px-2 py-2 text-slate-500">
                  {formatMetadata(row.metadataJson)}
                </td>
                {showClient ? (
                  <td className="max-w-[12rem] truncate px-2 py-2 text-slate-500" title={row.userAgent ?? ""}>
                    {row.ipAddress ?? "—"}
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
