import type { AdminOauthStatus } from "@/lib/admin-oauth-status";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`}
      aria-hidden
    />
  );
}

function ProviderBlock({ title, status }: { title: string; status: AdminOauthStatus["google"] }) {
  const ok = status.errorCodes.length === 0 && status.warnings.length === 0;
  return (
    <div className="space-y-1 border-l border-slate-800 pl-3 text-xs text-slate-400">
      <p className="flex items-center gap-2 font-medium text-slate-200">
        <StatusDot ok={ok} />
        {title}
      </p>
      <p>
        Enabled (admin DB):{" "}
        <span className="text-slate-300">{status.enabledRequested ? "yes" : "no"}</span>
        {" · "}
        Runtime registered:{" "}
        <span className="text-slate-300">{status.runtimeRegistered ? "yes" : "no"}</span>
        {" · "}
        Source: <span className="text-slate-300">{status.source}</span>
      </p>
      {status.warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-amber-200/90">
          {status.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">No configuration warnings for this provider.</p>
      )}
    </div>
  );
}

export function AdminOauthWarnings({ status }: { status: AdminOauthStatus }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="font-semibold text-slate-100">OAuth configuration warnings</h3>
      <p className="text-xs text-slate-500">
        Compares admin database toggles with what NextAuth actually registers at runtime (Authentik may use
        environment variables).
      </p>
      {status.globalWarnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-sm text-red-200/90">
          {status.globalWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-4 text-sm">
        <ProviderBlock title="Google" status={status.google} />
        <ProviderBlock title="Authentik" status={status.authentik} />
      </div>
    </section>
  );
}
