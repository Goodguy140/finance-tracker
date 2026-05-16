import { prisma } from "@/lib/prisma";

function formatMetadata(json: string | null): string {
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

export async function AdminAuditLog() {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { email: true, displayName: true } } },
  });

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="font-semibold text-slate-100">Audit log</h2>
      <p className="text-xs text-slate-500">Last 50 events (metadata is scrubbed server-side).</p>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">Time</th>
              <th className="px-2 py-2 font-medium">Actor</th>
              <th className="px-2 py-2 font-medium">Action</th>
              <th className="px-2 py-2 font-medium">Target</th>
              <th className="px-2 py-2 font-medium">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-slate-500">
                  No audit entries yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const actor = row.user?.email ?? "—";
                const target =
                  row.targetType || row.targetId
                    ? [row.targetType, row.targetId].filter(Boolean).join(" ")
                    : "—";
                return (
                  <tr key={row.id} className="border-t border-slate-800/80">
                    <td className="whitespace-nowrap px-2 py-2 text-slate-400">
                      {row.createdAt.toISOString().replace("T", " ").slice(0, 19)}Z
                    </td>
                    <td className="px-2 py-2">{actor}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-slate-200">{row.action}</td>
                    <td className="max-w-[10rem] truncate px-2 py-2 font-mono text-[11px]">{target}</td>
                    <td className="max-w-[14rem] truncate px-2 py-2 text-slate-500">{formatMetadata(row.metadataJson)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
