import type { AdminRuntimeMetrics } from "@/lib/admin-runtime-metrics";
import { formatUptime } from "@/lib/admin-runtime-metrics";

export function AdminRuntimeMetricsPanel({ metrics }: { metrics: AdminRuntimeMetrics }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="font-semibold text-slate-100">Runtime</h3>
      <p className="text-xs text-slate-500">Process metrics for this Node server instance (resets on restart).</p>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li>
          <p className="text-xs text-slate-500">Uptime</p>
          <p className="font-medium text-slate-100">{formatUptime(metrics.uptimeSeconds)}</p>
        </li>
        <li>
          <p className="text-xs text-slate-500">Memory (RSS / heap)</p>
          <p className="font-medium text-slate-100">
            {metrics.memory.rssMb} MB · {metrics.memory.heapUsedMb}/{metrics.memory.heapTotalMb} MB heap
          </p>
        </li>
        {metrics.databaseFile.applicable ? (
          <>
            <li>
              <p className="text-xs text-slate-500">SQLite file</p>
              <p className="font-medium text-slate-100">
                {metrics.databaseFile.pathLabel ?? "—"}
                {metrics.databaseFile.sizeMb != null ? ` · ${metrics.databaseFile.sizeMb} MB` : ""}
              </p>
            </li>
            <li>
              <p className="text-xs text-slate-500">Disk free (DB volume)</p>
              <p className="font-medium text-slate-100">
                {metrics.databaseFile.diskFreeGb != null ? `${metrics.databaseFile.diskFreeGb} GB` : "unavailable"}
              </p>
            </li>
          </>
        ) : (
          <li className="sm:col-span-2">
            <p className="text-xs text-slate-500">SQLite file metrics</p>
            <p className="text-slate-400">Not applicable (non-file database URL).</p>
          </li>
        )}
      </ul>
      <p className="text-xs text-slate-500">HTTP request and error rates are not tracked in this app.</p>
    </section>
  );
}
