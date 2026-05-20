import { buildAdminEnvConfig, formatEnvDisplay } from "@/lib/admin-env-config";

export function AdminEnvConfigPanel() {
  const entries = buildAdminEnvConfig();

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="font-semibold text-slate-100">Environment</h2>
      <p className="text-xs text-slate-500">
        Feature flags and non-secret configuration. Secrets show presence only — values are never displayed.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">Variable</th>
              <th className="px-2 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.name} className="border-t border-slate-800/80">
                <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-200">{entry.name}</td>
                <td className="px-2 py-2">
                  <span
                    className={
                      entry.display.kind === "presence" && entry.display.presence !== "present"
                        ? "text-amber-300/90"
                        : "text-slate-300"
                    }
                  >
                    {formatEnvDisplay(entry.display)}
                  </span>
                  {entry.note ? <p className="mt-0.5 text-[10px] text-slate-500">{entry.note}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
