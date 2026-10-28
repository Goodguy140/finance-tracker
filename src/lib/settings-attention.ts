import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { describePlaidItemAttention } from "@/lib/plaid/attention";
import { describePlaidCostWarning } from "@/lib/plaid/cost";
import { getPlaidConfig } from "@/lib/plaid/config";
import type { SettingsSectionId } from "@/lib/settings-sections";

/** Below this many unused recovery codes, Settings suggests making new ones. */
export const LOW_RECOVERY_CODES = 3;

export type SettingsAttentionItem = {
  section: SettingsSectionId;
  /** Short subject, e.g. the bank's name. */
  title: string;
  message: string;
  tone: "warn" | "bad";
};

export type SettingsAttention = {
  items: SettingsAttentionItem[];
  /** One dot per section in the nav, the worse tone winning. */
  dots: Partial<Record<SettingsSectionId, "warn" | "bad">>;
  /** Whether bank sync is usable on this server; the Connected banks page hides otherwise. */
  plaidConfigured: boolean;
  /** Whether this user has any bank connection, configured server or not. */
  hasBankConnections: boolean;
};

/**
 * What in a user's own settings wants their action: a bank that stopped syncing or costs
 * money for nothing, or an account with no passkey or almost no recovery codes. Shown as a
 * strip on the Settings home and as dots in the nav, so a problem is never only visible to
 * someone who happens to open the right page.
 */
export const loadSettingsAttention = cache(async (userId: string): Promise<SettingsAttention> => {
  const [items, secondFactors, recoveryCodes, plaidConfig] = await Promise.all([
    prisma.plaidItem.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        institutionName: true,
        status: true,
        consentExpiresAt: true,
        pendingExpirationAt: true,
        pendingDisconnectAt: true,
        pendingDisconnectReason: true,
        newAccountsAvailableAt: true,
        plaidAccounts: { select: { accountId: true, syncEnabled: true } },
      },
    }),
    // Any second factor counts: a passkey or an authenticator app.
    Promise.all([prisma.webAuthnCredential.count({ where: { userId } }), prisma.totpCredential.count({ where: { userId } })]).then(
      ([passkeyCount, totpCount]) => passkeyCount + totpCount,
    ),
    prisma.recoveryCode.count({ where: { userId, usedAt: null } }),
    getPlaidConfig(),
  ]);

  const out: SettingsAttentionItem[] = [];
  for (const item of items) {
    const title = item.institutionName ?? "Your bank";
    const attention = describePlaidItemAttention(item);
    if (attention) {
      out.push({ section: "banks", title, message: attention.message, tone: attention.kind === "reauth" ? "bad" : "warn" });
      continue;
    }
    const cost = describePlaidCostWarning({
      status: item.status,
      consentExpiresAt: item.consentExpiresAt,
      hasMappedAccount: item.plaidAccounts.some((a) => a.accountId !== null && a.syncEnabled),
    });
    if (cost) out.push({ section: "banks", title, message: cost, tone: "warn" });
  }
  if (secondFactors === 0) {
    out.push({
      section: "security",
      title: "No second factor yet",
      message: "Add a passkey or an authenticator app to protect this account. Connecting a bank and creating API tokens need one.",
      tone: "warn",
    });
  } else if (recoveryCodes < LOW_RECOVERY_CODES) {
    out.push({
      section: "security",
      title: "Recovery codes running out",
      message: `${recoveryCodes} unused recovery code${recoveryCodes === 1 ? "" : "s"} left. Make a new set so you can still get in without your passkey or authenticator app.`,
      tone: "warn",
    });
  }

  const dots: SettingsAttention["dots"] = {};
  for (const item of out) {
    if (dots[item.section] !== "bad") dots[item.section] = item.tone;
  }
  return { items: out, dots, plaidConfigured: plaidConfig !== null, hasBankConnections: items.length > 0 };
});
