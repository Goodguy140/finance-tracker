import { SecurityPanel } from "@/components/security-panel";
import { PasswordSection } from "@/components/settings/you-forms";
import { SettingsCard, SettingsPage } from "@/components/settings/ui";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import { getAuthentikProvider, getGoogleProvider } from "@/lib/oauth-provider-config";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ linked?: string | string[] }>;

export default async function SecuritySettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, mfa } = await requireLoadedUser();
  const sp = await searchParams;
  const linkedRaw = Array.isArray(sp.linked) ? sp.linked[0] : sp.linked;
  const [passkeys, recoveryCodesRemaining, authAccounts, googleProvider, authentikProvider, totp] = await Promise.all([
    prisma.webAuthnCredential.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, backedUp: true },
    }),
    prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    prisma.authAccount.findMany({ where: { userId: user.id }, select: { provider: true } }),
    getGoogleProvider(),
    getAuthentikProvider(),
    prisma.totpCredential.findUnique({ where: { userId: user.id }, select: { createdAt: true } }),
  ]);
  const linkedProviders = [...new Set(authAccounts.map((a) => a.provider))];
  const hasPassword = user.passwordHash != null;

  return (
    <SettingsPage section="security">
      <SecurityPanel
        hasPassword={hasPassword}
        passkeys={passkeys.map((pk) => ({
          id: pk.id,
          name: pk.name,
          createdAt: pk.createdAt.toISOString(),
          lastUsedAt: pk.lastUsedAt ? pk.lastUsedAt.toISOString() : null,
          backedUp: pk.backedUp,
        }))}
        authenticatorSince={totp ? totp.createdAt.toISOString() : null}
        recoveryCodesRemaining={recoveryCodesRemaining}
        freshUntil={mfa.verified && mfa.verifiedAt != null ? mfa.verifiedAt + MFA_STEP_UP_MAX_AGE_MS : null}
        linkedProviders={linkedProviders}
        availableProviders={[...(googleProvider ? ["google"] : []), ...(authentikProvider ? ["authentik"] : [])]}
        linkedJustNow={linkedRaw && linkedProviders.includes(linkedRaw) ? linkedRaw : null}
      />
      <SettingsCard title="Password">
        <PasswordSection hasPassword={hasPassword} />
      </SettingsCard>
    </SettingsPage>
  );
}
