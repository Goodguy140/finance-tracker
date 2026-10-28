import { PlaidConnectionsPanel } from "@/components/plaid-connections-panel";
import { SettingsPage } from "@/components/settings/ui";
import { MFA_STEP_UP_MAX_AGE_MS } from "@/lib/auth-constants";
import { formatDateOnlyUtc } from "@/lib/date-only";
import { describePlaidItemAttention } from "@/lib/plaid/attention";
import { getPlaidConfig } from "@/lib/plaid/config";
import { describePlaidCostWarning } from "@/lib/plaid/cost";
import { plaidFakeClientEnabled } from "@/lib/plaid/service";
import { describeHistorySetting, describeShortfall, HISTORY_WINDOWS } from "@/lib/plaid/window";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BanksSettingsPage() {
  const { user, mfa } = await requireLoadedUser();
  const [accounts, plaidItems, plaidConfig, fakeLink] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
    prisma.plaidItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: { plaidAccounts: { orderBy: { name: "asc" } } },
    }),
    getPlaidConfig(),
    plaidFakeClientEnabled(),
  ]);

  return (
    <SettingsPage section="banks">
      <PlaidConnectionsPanel
        configured={plaidConfig !== null}
        fakeLink={fakeLink}
        environment={plaidConfig?.environment ?? null}
        historyWindows={HISTORY_WINDOWS.map((w) => ({ days: w.days, label: w.label }))}
        accountOptions={accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency }))}
        mfa={{
          enrolled: mfa.required,
          factors: { passkey: mfa.passkeyCount > 0, totp: mfa.totp },
          freshUntil: mfa.verified && mfa.verifiedAt != null ? mfa.verifiedAt + MFA_STEP_UP_MAX_AGE_MS : null,
        }}
        items={plaidItems.map((item) => ({
          id: item.id,
          institutionName: item.institutionName ?? "Your bank",
          status: item.status,
          errorMessage: item.errorMessage,
          // Read from the stored cutoff rather than recomputed, so what the user was promised
          // when they linked cannot drift as days pass.
          historyLine: describeHistorySetting(item.requestedDays, item.historyCutoff),
          shortfallLine: describeShortfall({
            institutionName: item.institutionName,
            requestedDays: item.requestedDays,
            requestedCutoff: item.historyCutoff,
            earliestObserved: item.initialSyncDoneAt ? item.earliestObservedAt : null,
          }),
          // Plaid bills per connected item per month, whether or not it works. A connection
          // that cannot sync is money leaving with nothing coming back, so say so plainly
          // rather than leaving a quietly broken row in the list.
          costWarning: describePlaidCostWarning({
            status: item.status,
            consentExpiresAt: item.consentExpiresAt,
            hasMappedAccount: item.plaidAccounts.some((a) => a.accountId !== null && a.syncEnabled),
          }),
          // Raised by Plaid's ITEM webhooks (or a failed sync) and cleared by update mode.
          attention: describePlaidItemAttention(item),
          lastSyncedLabel: item.lastSyncedAt ? formatDateOnlyUtc(item.lastSyncedAt) : null,
          consentExpiresLabel: item.consentExpiresAt ? formatDateOnlyUtc(item.consentExpiresAt) : null,
          accounts: item.plaidAccounts.map((account) => ({
            id: account.id,
            name: account.name,
            officialName: account.officialName,
            mask: account.mask,
            typeLabel: account.plaidSubtype ? `${account.plaidType} · ${account.plaidSubtype}` : account.plaidType,
            currency: account.currency,
            accountId: account.accountId,
            syncEnabled: account.syncEnabled,
          })),
        }))}
      />
    </SettingsPage>
  );
}
