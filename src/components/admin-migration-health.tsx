import type { OAuthProviderHealth } from "@/lib/migration-health";

type MigrationHealthProps = {
  schema: { status: "ok" | "drift" | "skipped"; missing: string[] };
  oauth: {
    allReadable: boolean;
    failedKeys: string[];
    google: OAuthProviderHealth;
    authentik: OAuthProviderHealth;
    hasAnyStored: boolean;
  };
  repair: { ran: boolean; lastAt: string | null; version: string | null };
};

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`}
      aria-hidden
    />
  );
}

function providerLabel(status: OAuthProviderHealth) {
  switch (status) {
    case "ok":
      return "Readable";
    case "decrypt_failed":
      return "Decryption failed";
    case "not_configured":
      return "Not stored in DB";
  }
}

function HealthRow({ title, ok, detail }: { title: string; ok: boolean; detail: string }) {
  return (
    <div>
      <p className={`font-medium ${ok ? "text-slate-100" : "text-red-200"}`}>{title}</p>
      <p className="text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export function AdminMigrationHealthPanel({ schema, oauth, repair }: MigrationHealthProps) {
  const schemaOk = schema.status === "ok" || schema.status === "skipped";
  const schemaDetail =
    schema.status === "skipped"
      ? "Schema check applies to SQLite file databases only."
      : schema.status === "ok"
        ? "All repair-script columns are present."
        : `Missing: ${schema.missing.join(", ")}`;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="font-semibold text-slate-100">Migration &amp; ops health</h3>
      <p className="text-xs text-slate-500">
        Verifies encrypted OAuth settings and SQLite schema repair state after deploy.
      </p>

      <ul className="space-y-3 text-sm">
        <li className="flex gap-3">
          <StatusDot ok={oauth.allReadable} />
          <HealthRow
            title="OAuth settings readable"
            ok={oauth.allReadable}
            detail={
              oauth.allReadable
                ? oauth.hasAnyStored
                  ? "All stored oauth.* values decrypt with the current SERVER_SETTINGS_ENCRYPTION_KEY."
                  : "No oauth.* values in the database yet."
                : "Decryption failed — check SERVER_SETTINGS_ENCRYPTION_KEY matches the key used when settings were saved."
            }
          />
        </li>
        <li className="ml-5 space-y-1 border-l border-slate-800 pl-3 text-xs text-slate-400">
          <p>
            Google:{" "}
            <span className={oauth.google === "decrypt_failed" ? "text-red-300" : "text-slate-300"}>
              {providerLabel(oauth.google)}
            </span>
          </p>
          <p>
            Authentik:{" "}
            <span className={oauth.authentik === "decrypt_failed" ? "text-red-300" : "text-slate-300"}>
              {providerLabel(oauth.authentik)}
            </span>
          </p>
          {oauth.failedKeys.length > 0 ? (
            <p className="font-mono text-red-300/90">{oauth.failedKeys.join(", ")}</p>
          ) : null}
        </li>

        <li className="flex gap-3">
          <StatusDot ok={schemaOk} />
          <HealthRow
            title={schemaOk ? "Schema OK" : "Schema drift detected"}
            ok={schemaOk}
            detail={
              schemaOk
                ? schemaDetail
                : `${schemaDetail} Restart the container or run scripts/repair-sqlite-schema.cjs.`
            }
          />
        </li>

        <li className="flex gap-3">
          <StatusDot ok={repair.ran} />
          <HealthRow
            title={repair.ran ? "SQLite repair step recorded" : "SQLite repair step not recorded"}
            ok={repair.ran}
            detail={
              repair.ran
                ? `Last run: ${repair.lastAt ?? "unknown"}${repair.version ? ` (v${repair.version})` : ""}`
                : "ops.lastSchemaRepairAt was not written — repair may not have run since this marker was added."
            }
          />
        </li>
      </ul>
    </section>
  );
}
