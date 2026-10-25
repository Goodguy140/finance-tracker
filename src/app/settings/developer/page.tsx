import { ApiTokensPanel } from "@/components/api-tokens-panel";
import { WebhooksPanel } from "@/components/webhooks-panel";
import { SettingsPage } from "@/components/settings/ui";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DeveloperSettingsPage() {
  const { user, mfa } = await requireLoadedUser();
  const tokens = await prisma.personalAccessToken.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, tokenPrefix: true, scopes: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  const hooks = await prisma.webhookEndpoint.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, events: true, enabled: true, lastDeliveredAt: true, lastStatus: true, lastError: true },
  });
  return (
    <SettingsPage section="developer">
      <ApiTokensPanel
        tokens={tokens.map((token) => ({
          id: token.id,
          name: token.name,
          tokenPrefix: token.tokenPrefix,
          scopes: token.scopes,
          createdAt: token.createdAt.toISOString(),
          lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
          expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
        }))}
        mfa={{
          enrolled: mfa.passkeyCount > 0,
          freshUntil: mfa.verified && mfa.verifiedAt != null ? mfa.verifiedAt + MFA_STEP_UP_MAX_AGE_MS : null,
        }}
      />
      <div className="mt-8 border-t border-slate-800 pt-6">
        <WebhooksPanel
          hooks={hooks.map((hook) => ({
            ...hook,
            events: hook.events.split(","),
            lastDeliveredAt: hook.lastDeliveredAt ? hook.lastDeliveredAt.toISOString() : null,
          }))}
        />
      </div>
    </SettingsPage>
  );
}
