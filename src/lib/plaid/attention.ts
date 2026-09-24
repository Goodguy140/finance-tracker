import { PlaidItemStatus, type Prisma } from "@prisma/client";
import { formatDateOnlyUtc } from "@/lib/date-only";

/**
 * The one thing a bank connection currently needs from its user, if anything.
 *
 * Several can be true at once — a bank can want a sign-in *and* have new accounts — but a
 * row that shows four callouts is a row nobody reads, so exactly one is surfaced, most
 * urgent first. Clearing it (via update mode, or Plaid's LOGIN_REPAIRED) exposes the next.
 *
 *  1. sign-in required: nothing is syncing right now;
 *  2. pending disconnect: syncing stops soon, on a date the bank chose;
 *  3. pending expiration: syncing stops when consent lapses;
 *  4. new accounts: nothing is broken, there is just more on offer.
 */

export type PlaidAttentionKind = "reauth" | "disconnecting" | "expiring" | "new-accounts";

export type PlaidItemAttention = {
  kind: PlaidAttentionKind;
  message: string;
  /** Which update-mode flow fixes it — `updateKind` on the link-token request. */
  action: "reauth" | "accounts";
  actionLabel: string;
};

export type PlaidAttentionInput = {
  institutionName: string | null;
  status: string;
  consentExpiresAt: Date | null;
  pendingExpirationAt: Date | null;
  pendingDisconnectAt: Date | null;
  pendingDisconnectReason: string | null;
  newAccountsAvailableAt: Date | null;
};

/** The dashboard's count query. Must agree with `describePlaidItemAttention` returning non-null. */
export const PLAID_ITEM_NEEDS_ATTENTION_WHERE = {
  OR: [
    { status: PlaidItemStatus.LOGIN_REQUIRED },
    { pendingDisconnectAt: { not: null } },
    { pendingExpirationAt: { not: null } },
    { newAccountsAvailableAt: { not: null } },
  ],
} satisfies Prisma.PlaidItemWhereInput;

export function describePlaidItemAttention(item: PlaidAttentionInput): PlaidItemAttention | null {
  const bank = item.institutionName ?? "Your bank";

  if (item.status === PlaidItemStatus.LOGIN_REQUIRED) {
    return {
      kind: "reauth",
      message: `${bank} needs you to sign in again. Nothing new will sync until you do.`,
      action: "reauth",
      actionLabel: "Sign in again",
    };
  }

  if (item.pendingDisconnectAt) {
    const why =
      item.pendingDisconnectReason === "INSTITUTION_MIGRATION"
        ? " because the bank is changing how it connects"
        : "";
    return {
      kind: "disconnecting",
      message: `${bank} will stop sharing transactions with this app soon${why}. Renew access to keep it syncing.`,
      action: "reauth",
      actionLabel: "Renew access",
    };
  }

  if (item.pendingExpirationAt) {
    const when = item.consentExpiresAt ? ` on ${formatDateOnlyUtc(item.consentExpiresAt)}` : " soon";
    return {
      kind: "expiring",
      message: `Your consent for ${bank} expires${when}. Renew access to keep it syncing.`,
      action: "reauth",
      actionLabel: "Renew access",
    };
  }

  if (item.newAccountsAvailableAt) {
    return {
      kind: "new-accounts",
      message: `${bank} has accounts you have not shared yet. Choose which ones to add.`,
      action: "accounts",
      actionLabel: "Add new accounts",
    };
  }

  return null;
}
