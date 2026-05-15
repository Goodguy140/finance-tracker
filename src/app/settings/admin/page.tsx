import Link from "next/link";
import { AdminOauthForm } from "@/components/forms";
import { decryptSecret } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [googleEnabledRow, googleIdRow, authentikEnabledRow, authentikIssuerRow, authentikIdRow] =
    await Promise.all([
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.enabled" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.google.clientId" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.enabled" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.issuer" } }),
      prisma.serverSetting.findUnique({ where: { key: "oauth.authentik.clientId" } }),
    ]);

  const googleEnabled = googleEnabledRow ? decryptSecret(googleEnabledRow.encryptedValue) === "true" : false;
  const googleClientId = googleIdRow ? decryptSecret(googleIdRow.encryptedValue) : "";
  const authentikEnabled = authentikEnabledRow ? decryptSecret(authentikEnabledRow.encryptedValue) === "true" : false;
  const authentikIssuer = authentikIssuerRow ? decryptSecret(authentikIssuerRow.encryptedValue) : "";
  const authentikClientId = authentikIdRow ? decryptSecret(authentikIdRow.encryptedValue) : "";
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
      <AdminOauthForm
        googleEnabled={googleEnabled}
        googleClientId={googleClientId}
        authentikEnabled={authentikEnabled}
        authentikIssuer={authentikIssuer}
        authentikClientId={authentikClientId}
        authentikConfiguredViaEnv={authentikConfiguredViaEnv}
      />
    </main>
  );
}
