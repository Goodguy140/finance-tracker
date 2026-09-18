import Link from "next/link";
import { AdminAnalyticsPanel } from "@/components/admin-analytics-panel";
import { AdminAuditLog } from "@/components/admin-audit-log";
import { AdminBackupPanel } from "@/components/admin-backup-panel";
import { AdminEnvConfigPanel } from "@/components/admin-env-config";
import { AdminMigrationHealthPanel } from "@/components/admin-migration-health";
import { AdminOauthWarnings } from "@/components/admin-oauth-warnings";
import { AdminRuntimeMetricsPanel } from "@/components/admin-runtime-metrics";
import { AdminSystemHealthPanel } from "@/components/admin-system-health";
import { AdminOauthForm } from "@/components/forms";
import { getAdminAnalytics } from "@/lib/admin-analytics";
import { getAdminOauthStatus } from "@/lib/admin-oauth-status";
import { getAdminRuntimeMetrics } from "@/lib/admin-runtime-metrics";
import { getAdminSystemHealth } from "@/lib/admin-system-health";
import { getMigrationHealth, tryDecryptServerSetting } from "@/lib/migration-health";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

function readSetting(
  row: { encryptedValue: string } | null,
  fallback = "",
): string {
  if (!row) return fallback;
  return tryDecryptServerSetting(row.encryptedValue) ?? fallback;
}

function readBooleanSetting(row: { encryptedValue: string } | null): boolean {
  return readSetting(row) === "true";
}

export default async function AdminSettingsPage() {
  await requireAdmin();
  const runtimeMetrics = getAdminRuntimeMetrics();
  const [health, systemHealth, analytics, oauthStatus, googleEnabledRow, googleIdRow, authentikEnabledRow, authentikIssuerRow, authentikIdRow] =
    await Promise.all([
      getMigrationHealth(prisma),
      getAdminSystemHealth(prisma),
      getAdminAnalytics(prisma),
      getAdminOauthStatus(prisma),
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.enabled" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.clientId" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.enabled" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.issuer" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.clientId" } }),
    ]);

  const googleEnabled = readBooleanSetting(googleEnabledRow);
  const googleClientId = readSetting(googleIdRow);
  const authentikEnabled = readBooleanSetting(authentikEnabledRow);
  const authentikIssuer = readSetting(authentikIssuerRow);
  const authentikClientId = readSetting(authentikIdRow);
  const authentikConfiguredViaEnv = Boolean(
    process.env.AUTHENTIK_ISSUER?.trim() &&
      process.env.AUTHENTIK_CLIENT_ID?.trim() &&
      process.env.AUTHENTIK_CLIENT_SECRET?.trim(),
  );

  return (
    <main className="mx-auto my-8 max-w-2xl space-y-4 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin Settings</h1>
        <Link href="/settings" className="text-blue-300 hover:text-blue-200 underline">
          Back to settings
        </Link>
      </div>
      <AdminSystemHealthPanel health={systemHealth} />
      <AdminRuntimeMetricsPanel metrics={runtimeMetrics} />
      <AdminAnalyticsPanel analytics={analytics} />
      <AdminEnvConfigPanel />
      <AdminMigrationHealthPanel schema={health.schema} oauth={health.oauth} repair={health.repair} />
      <AdminOauthWarnings status={oauthStatus} />
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="font-semibold text-slate-100">Users</h2>
        <p className="text-xs text-slate-500">
          Review who has access, change roles, suspend or remove accounts, and end sessions.
        </p>
        <Link
          href="/settings/admin/users"
          className="inline-flex rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
        >
          Manage users
        </Link>
      </section>
      <AdminOauthForm
        googleEnabled={googleEnabled}
        googleClientId={googleClientId}
        authentikEnabled={authentikEnabled}
        authentikIssuer={authentikIssuer}
        authentikClientId={authentikClientId}
        authentikConfiguredViaEnv={authentikConfiguredViaEnv}
      />
      <AdminBackupPanel />
      <AdminAuditLog />
    </main>
  );
}
