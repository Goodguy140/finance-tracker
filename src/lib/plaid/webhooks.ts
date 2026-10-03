import { PlaidItemStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import type { PlaidClient } from "@/lib/plaid/client";
import { endConnection } from "@/lib/plaid/connections";
import { purgePlaidAccountData } from "@/lib/plaid/purge";
import { openAccessToken } from "@/lib/plaid/service";
import type { PlaidApiErrorPayload } from "@/lib/plaid/types";
import { attentionCleared, loginRequired, parseConsentExpiry } from "@/lib/plaid/item-state";
import { resolvePlaidWebhookUrl } from "@/lib/plaid/webhook-url";

/**
 * What an ITEM webhook means for the bank connection it names.
 *
 * Split like sync-plan / sync-store: `planPlaidWebhook` is pure and says which columns
 * change, `applyPlaidWebhook` finds the item and writes them. None of it touches the
 * transaction log or the review queue — a webhook only ever changes what the user is
 * *prompted* to do, so an unattended delivery is as safe as the unattended sweep.
 *
 * The one exception is consent withdrawn at Plaid (`USER_PERMISSION_REVOKED`,
 * `USER_ACCOUNT_REVOKED`, see `applyConsentRevocation`). There is no prompt to raise: the
 * user has already said no, so what was synced under that consent is deleted. The user's
 * committed transactions are still never touched.
 *
 * Every plan is a set of absolute values rather than a delta, so a redelivery (Plaid
 * retries anything that did not get a 200) lands on the same state.
 */

export type PlaidWebhookBody = {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
  error?: PlaidApiErrorPayload | null;
  consent_expiration_time?: unknown;
  reason?: unknown;
  account_id?: unknown;
};

export type PlaidWebhookPlan = {
  code: string;
  data: Prisma.PlaidItemUpdateInput;
  /** Re-read the item from Plaid afterwards so consentExpiresAt reflects the repair. */
  refreshConsent: boolean;
  auditAction: string;
};

export function planPlaidWebhook(body: PlaidWebhookBody, now: Date): PlaidWebhookPlan | null {
  if (body.webhook_type !== "ITEM") return null;
  const code = typeof body.webhook_code === "string" ? body.webhook_code : "";

  const signInNeeded =
    (code === "ERROR" && body.error?.error_code === "ITEM_LOGIN_REQUIRED") ||
    code === "ITEM_LOGIN_REQUIRED";
  if (signInNeeded) {
    return {
      code: "ITEM_LOGIN_REQUIRED",
      data: loginRequired(body.error?.display_message),
      refreshConsent: false,
      auditAction: AUDIT_ACTIONS.plaid_item_reauth_required,
    };
  }

  switch (code) {
    case "ERROR":
      // Anything else is recorded where the panel already shows sync errors. It does not
      // flip the status: only a sign-in problem has a fix the user can act on here.
      return {
        code,
        data: {
          lastSyncError:
            body.error?.display_message ||
            body.error?.error_message ||
            `Plaid reported ${body.error?.error_code ?? "an error"} for this bank.`,
        },
        refreshConsent: false,
        auditAction: AUDIT_ACTIONS.plaid_webhook_received,
      };
    case "PENDING_EXPIRATION": {
      const expires = parseConsentExpiry(body.consent_expiration_time);
      return {
        code,
        data: { pendingExpirationAt: now, ...(expires ? { consentExpiresAt: expires } : {}) },
        refreshConsent: false,
        auditAction: AUDIT_ACTIONS.plaid_webhook_received,
      };
    }
    case "PENDING_DISCONNECT":
      return {
        code,
        data: {
          pendingDisconnectAt: now,
          pendingDisconnectReason: typeof body.reason === "string" ? body.reason : null,
        },
        refreshConsent: false,
        auditAction: AUDIT_ACTIONS.plaid_webhook_received,
      };
    case "LOGIN_REPAIRED":
      // The user signed in again somewhere else (another app on the same connection), so
      // every prompt that asked them to is now wrong.
      return {
        code,
        data: attentionCleared(),
        refreshConsent: true,
        auditAction: AUDIT_ACTIONS.plaid_webhook_received,
      };
    case "NEW_ACCOUNTS_AVAILABLE":
      return {
        code,
        data: { newAccountsAvailableAt: now },
        refreshConsent: false,
        auditAction: AUDIT_ACTIONS.plaid_webhook_received,
      };
    default:
      return null;
  }
}

export type WebhookOutcome = "applied" | "ignored" | "unknown-item";

/**
 * Applies one verified delivery. The caller has already checked the signature; this only
 * decides what it means.
 *
 * The audit row is the last write, so a test (or an operator) waiting on it knows the item
 * update and any consent refresh have both landed.
 */
export async function applyPlaidWebhook(
  deps: { prisma: PrismaClient; client: PlaidClient; now?: Date },
  body: PlaidWebhookBody,
): Promise<WebhookOutcome> {
  const now = deps.now ?? new Date();
  if (isConsentRevocation(body)) return applyConsentRevocation(deps, body, now);
  const plan = planPlaidWebhook(body, now);
  if (!plan) return "ignored";
  if (typeof body.item_id !== "string" || !body.item_id) return "ignored";

  const item = await deps.prisma.plaidItem.findUnique({ where: { itemId: body.item_id } });
  if (!item || item.status === PlaidItemStatus.REMOVED) return "unknown-item";

  await deps.prisma.plaidItem.update({ where: { id: item.id }, data: plan.data });

  if (plan.refreshConsent) {
    try {
      const { item: fresh } = await deps.client.getAccounts(openAccessToken(item));
      await deps.prisma.plaidItem.update({
        where: { id: item.id },
        data: { consentExpiresAt: parseConsentExpiry(fresh?.consent_expiration_time) },
      });
    } catch (err) {
      // Cosmetic: the prompt is already cleared, and the next sync reports any real fault.
      console.error("[plaid] could not refresh consent after LOGIN_REPAIRED", err);
    }
  }

  await recordAuditLog(deps.prisma, {
    userId: item.userId,
    action: plan.auditAction,
    targetType: "PlaidItem",
    targetId: item.id,
    metadata: { code: plan.code, institution: item.institutionName, source: "webhook" },
    headers: new Headers(),
  });
  return "applied";
}

function isConsentRevocation(body: PlaidWebhookBody): boolean {
  return (
    body.webhook_type === "ITEM" &&
    (body.webhook_code === "USER_PERMISSION_REVOKED" || body.webhook_code === "USER_ACCOUNT_REVOKED")
  );
}

/**
 * The user withdrew Plaid's access — to the whole connection, or to one account in it — from
 * outside this app (the bank, or my.plaid.com). The data was synced under that consent, so
 * it goes: the same purge as unlinking, or its one-account equivalent.
 *
 * For the whole connection the item is also removed at Plaid first, as unlinking does; an
 * item that is already gone there counts as removed. If removal fails this throws, the route
 * answers 500, and Plaid redelivers — nothing is deleted until the connection has ended.
 *
 * The audit row is the last write, as for every other webhook.
 */
async function applyConsentRevocation(
  deps: { prisma: PrismaClient; client: PlaidClient },
  body: PlaidWebhookBody,
  now: Date,
): Promise<WebhookOutcome> {
  if (typeof body.item_id !== "string" || !body.item_id) return "ignored";
  const item = await deps.prisma.plaidItem.findUnique({ where: { itemId: body.item_id } });
  if (!item) return "unknown-item";

  if (body.webhook_code === "USER_PERMISSION_REVOKED") {
    // Removed at Plaid first, as unlinking does. If that fails this throws, the route answers
    // 500, and Plaid redelivers: nothing is deleted until the connection has ended.
    await endConnection(deps, item, now);
    await recordAuditLog(deps.prisma, {
      userId: item.userId,
      action: AUDIT_ACTIONS.plaid_item_consent_revoked,
      targetType: "PlaidItem",
      targetId: item.id,
      metadata: { code: body.webhook_code, institution: item.institutionName, source: "webhook" },
      headers: new Headers(),
    });
    return "applied";
  }

  if (typeof body.account_id !== "string" || !body.account_id) return "ignored";
  const accountId = body.account_id;
  const purged = await deps.prisma.$transaction((tx) => purgePlaidAccountData(tx, item, accountId, now));
  if (!purged) return "ignored";
  await recordAuditLog(deps.prisma, {
    userId: item.userId,
    action: AUDIT_ACTIONS.plaid_account_consent_revoked,
    targetType: "PlaidItem",
    targetId: item.id,
    metadata: { code: body.webhook_code, institution: item.institutionName, source: "webhook" },
    headers: new Headers(),
  });
  return "applied";
}

/**
 * Points an item's webhooks at this deployment's URL when Plaid holds a different one (or
 * none, for banks linked before webhooks existed). One Plaid call per item per URL change;
 * a failure is logged and never blocks the sync it runs ahead of.
 */
export async function ensurePlaidItemWebhook(
  deps: { prisma: Pick<PrismaClient, "plaidItem">; client: PlaidClient; env?: Record<string, string | undefined> },
  itemId: string,
): Promise<void> {
  const url = resolvePlaidWebhookUrl(deps.env);
  if (!url) return;
  const item = await deps.prisma.plaidItem.findUnique({
    where: { id: itemId },
    select: { id: true, webhookUrl: true, accessTokenEnc: true },
  });
  if (!item || item.webhookUrl === url) return;
  try {
    await deps.client.updateItemWebhook(openAccessToken(item), url);
    await deps.prisma.plaidItem.update({ where: { id: item.id }, data: { webhookUrl: url } });
  } catch (err) {
    console.error("[plaid] could not register the webhook URL for an item", err);
  }
}
