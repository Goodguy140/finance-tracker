import type { AdminSystemHealth } from "@/lib/admin-system-health";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`}
      aria-hidden
    />
  );
}

function envLabel(p: AdminSystemHealth["env"]["NEXTAUTH_SECRET"]) {
  switch (p) {
    case "present":
      return "present";
    case "missing":
      return "missing";
    case "invalid":
      return "invalid / too short";
  }
}

export function AdminSystemHealthPanel({ health }: { health: AdminSystemHealth }) {
  const envOk =
    health.env.NEXTAUTH_SECRET === "present" &&
    health.env.SERVER_SETTINGS_ENCRYPTION_KEY === "present" &&
    health.env.NEXTAUTH_URL === "present";

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="font-semibold text-slate-100">System health</h3>
      <p className="text-xs text-slate-500">Non-secret snapshot for operators (same checks as the admin page only).</p>

      <ul className="space-y-3 text-sm">
        <li className="flex gap-3">
          <StatusDot ok={health.database.reachable} />
          <div>
            <p className="font-medium text-slate-100">Database</p>
            <p className="text-xs text-slate-500">
              {health.database.reachable ? "Reachable" : "Unreachable"} · {health.database.providerLabel} ·{" "}
              <span className="text-slate-400">{health.database.urlSummary.label}</span>
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StatusDot ok={envOk} />
          <div>
            <p className="font-medium text-slate-100">Required environment</p>
            <p className="text-xs text-slate-500">
              NEXTAUTH_SECRET: {envLabel(health.env.NEXTAUTH_SECRET)} · SERVER_SETTINGS_ENCRYPTION_KEY:{" "}
              {envLabel(health.env.SERVER_SETTINGS_ENCRYPTION_KEY)} · NEXTAUTH_URL: {envLabel(health.env.NEXTAUTH_URL)}
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <StatusDot ok />
          <div>
            <p className="font-medium text-slate-100">App version</p>
            <p className="text-xs text-slate-500">{health.appVersionLine}</p>
          </div>
        </li>
        <li className="flex gap-3">
          <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-600" aria-hidden />
          <div>
            <p className="font-medium text-slate-100">Auth providers (runtime)</p>
            <p className="text-xs text-slate-500">
              Credentials: registered · Google: {health.authProviders.googleRuntime ? "yes" : "no"} · Authentik:{" "}
              {health.authProviders.authentikRuntime ? "yes" : "no"}
            </p>
          </div>
        </li>
      </ul>
      <p className="text-xs text-slate-500">
        Migration and encrypted OAuth readability are covered in <strong>Migration &amp; ops health</strong>.
      </p>
    </section>
  );
}
