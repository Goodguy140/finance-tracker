import Link from "next/link";
import { AdminOauthForm } from "@/components/forms";
import { decryptSecret } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [enabledRow, idRow] = await Promise.all([
    prisma.serverSetting.findUnique({ where: { key: "oauth.google.enabled" } }),
    prisma.serverSetting.findUnique({ where: { key: "oauth.google.clientId" } }),
  ]);

  const enabled = enabledRow ? decryptSecret(enabledRow.encryptedValue) === "true" : false;
  const clientId = idRow ? decryptSecret(idRow.encryptedValue) : "";

  return (
    <main className="mx-auto my-8 max-w-2xl space-y-4 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin Settings</h1>
        <Link href="/settings" className="text-blue-300 hover:text-blue-200 underline">Back to settings</Link>
      </div>
      <AdminOauthForm googleEnabled={enabled} googleClientId={clientId} />
    </main>
  );
}
