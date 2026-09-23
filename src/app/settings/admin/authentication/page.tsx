import { AdminOauthWarnings } from "@/components/admin-oauth-warnings";
import { AdminPageHeader } from "@/components/admin/ui";
import { AdminOauthForm, AdminPasswordLoginForm } from "@/components/forms";
import { AdminSignupPolicyForm } from "@/components/admin/admin-ops-forms";
import { getAdminOauthStatus } from "@/lib/admin-oauth-status";
import { resolvePasswordLoginDisabledEnv } from "@/lib/auth-settings";
import { tryDecryptServerSetting } from "@/lib/migration-health";
import { isPasswordLoginDisabled } from "@/lib/oauth-provider-config";
import { getOpsSettingsStatus } from "@/lib/ops-settings";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

const OAUTH_KEYS = [
  "oauth.google.enabled",
  "oauth.google.clientId",
  "oauth.authentik.enabled",
  "oauth.authentik.issuer",
  "oauth.authentik.clientId",
] as const;

export default async function AdminAuthenticationPage() {
  await requireAdmin();
  const [oauthStatus, passwordLoginDisabled, rows, ops] = await Promise.all([
    getAdminOauthStatus(prisma),
    isPasswordLoginDisabled(),
    prisma.serverSetting.findMany({ where: { key: { in: [...OAUTH_KEYS] } } }),
    getOpsSettingsStatus(),
  ]);
  const byKey = new Map(rows.map((row) => [row.key, tryDecryptServerSetting(row.encryptedValue) ?? ""]));
  const read = (key: (typeof OAUTH_KEYS)[number]) => byKey.get(key) ?? "";

  const authentikConfiguredViaEnv = Boolean(
    process.env.AUTHENTIK_ISSUER?.trim() &&
      process.env.AUTHENTIK_CLIENT_ID?.trim() &&
      process.env.AUTHENTIK_CLIENT_SECRET?.trim(),
  );

  return (
    <>
      <AdminPageHeader
        title="Authentication"
        description="Who can create an account, and how people sign in."
      />
      <AdminSignupPolicyForm status={ops.publicSignup} />
      <AdminPasswordLoginForm
        passwordLoginDisabled={passwordLoginDisabled}
        configuredViaEnv={resolvePasswordLoginDisabledEnv() !== null}
      />
      <AdminOauthWarnings status={oauthStatus} />
      <AdminOauthForm
        googleEnabled={read("oauth.google.enabled") === "true"}
        googleClientId={read("oauth.google.clientId")}
        authentikEnabled={read("oauth.authentik.enabled") === "true"}
        authentikIssuer={read("oauth.authentik.issuer")}
        authentikClientId={read("oauth.authentik.clientId")}
        authentikConfiguredViaEnv={authentikConfiguredViaEnv}
      />
    </>
  );
}
