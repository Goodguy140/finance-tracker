import Link from "next/link";
import { AdminAuditLog } from "@/components/admin-audit-log";
import { AdminBackupPanel } from "@/components/admin-backup-panel";
import { AdminMigrationHealthPanel } from "@/components/admin-migration-health";
import { AdminOauthWarnings } from "@/components/admin-oauth-warnings";
import { AdminSystemHealthPanel } from "@/components/admin-system-health";
import { AdminOauthForm } from "@/components/forms";
import { getAdminOauthStatus } from "@/lib/admin-oauth-status";
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
  const [health, systemHealth, oauthStatus, googleEnabledRow, googleIdRow, authentikEnabledRow, authentikIssuerRow, authentikIdRow] =
    await Promise.all([
      getMigrationHealth(prisma),
      getAdminSystemHealth(prisma),
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
      <AdminMigrationHealthPanel schema={health.schema} oauth={health.oauth} repair={health.repair} />
      <AdminOauthWarnings status={oauthStatus} />
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
