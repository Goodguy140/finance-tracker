import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { clientIpFromForwardingHeaders } from "@/lib/client-ip";
import { getAuditRetentionDays, resolveAuditRetention } from "@/lib/ops-settings";

export const AUDIT_ACTIONS = {
  admin_oauth_settings_updated: "admin_oauth_settings_updated",
  user_signed_up: "user_signed_up",
  user_login_succeeded: "user_login_succeeded",
  user_login_failed: "user_login_failed",
  user_logout: "user_logout",
  user_password_changed: "user_password_changed",
  user_password_reset: "user_password_reset",
  user_sessions_revoked: "user_sessions_revoked",
  admin_user_role_changed: "admin_user_role_changed",
  admin_user_disabled: "admin_user_disabled",
  admin_user_enabled: "admin_user_enabled",
  admin_user_sessions_revoked: "admin_user_sessions_revoked",
  admin_user_deleted: "admin_user_deleted",
  admin_audit_exported: "admin_audit_exported",
  admin_auth_settings_updated: "admin_auth_settings_updated",
  admin_ops_settings_updated: "admin_ops_settings_updated",
  admin_database_backup_created: "admin_database_backup_created",
  user_backup_imported: "user_backup_imported",
  financial_account_created: "financial_account_created",
  financial_account_archived: "financial_account_archived",
  financial_account_unarchived: "financial_account_unarchived",
  financial_account_deleted: "financial_account_deleted",
  user_account_deleted: "user_account_deleted",
  user_backup_exported: "user_backup_exported",
  user_printable_downloaded: "user_printable_downloaded",
  api_token_created: "api_token_created",
  api_token_revoked: "api_token_revoked",
  webhook_created: "webhook_created",
  webhook_deleted: "webhook_deleted",
  api_budgets_read: "api_budgets_read",
  api_transactions_read: "api_transactions_read",
  api_transaction_created: "api_transaction_created",
  passkey_registered: "passkey_registered",
  passkey_renamed: "passkey_renamed",
  passkey_removed: "passkey_removed",
  totp_enabled: "totp_enabled",
  totp_removed: "totp_removed",
  mfa_disabled: "mfa_disabled",
  mfa_verified: "mfa_verified",
  mfa_verification_failed: "mfa_verification_failed",
  mfa_step_up: "mfa_step_up",
  recovery_codes_generated: "recovery_codes_generated",
  recovery_code_used: "recovery_code_used",
  sso_link_started: "sso_link_started",
  sso_account_linked: "sso_account_linked",
  sso_link_rejected: "sso_link_rejected",
  sso_account_unlinked: "sso_account_unlinked",
  plaid_settings_updated: "plaid_settings_updated",
  plaid_link_started: "plaid_link_started",
  plaid_item_linked: "plaid_item_linked",
  plaid_item_unlinked: "plaid_item_unlinked",
  plaid_item_unlink_failed: "plaid_item_unlink_failed",
  plaid_item_revoke_skipped: "plaid_item_revoke_skipped",
  plaid_account_mapped: "plaid_account_mapped",
  plaid_item_sync_succeeded: "plaid_item_sync_succeeded",
  plaid_item_sync_failed: "plaid_item_sync_failed",
  plaid_item_reauth_required: "plaid_item_reauth_required",
  plaid_transactions_committed: "plaid_transactions_committed",
  plaid_webhook_received: "plaid_webhook_received",
  plaid_item_update_completed: "plaid_item_update_completed",
  plaid_item_consent_revoked: "plaid_item_consent_revoked",
  plaid_account_consent_revoked: "plaid_account_consent_revoked",
  transaction_rule_applied: "transaction_rule_applied",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const SECRET_KEY_PATTERN =
  /password|secret|token|hash|encrypted|clientsecret|authorization|cookie|session/i;

const MAX_STRING = 500;
const MAX_DEPTH = 6;

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[truncated-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => scrubValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = scrubValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function scrubAuditMetadata(obj: Record<string, unknown> | undefined | null): Record<string, unknown> {
  if (!obj) return {};
  return scrubValue(obj, 0) as Record<string, unknown>;
}

export function clientMetaFromHeaders(h: Headers): { ipAddress?: string; userAgent?: string } {
  const ipAddress = clientIpFromForwardingHeaders(h.get("x-forwarded-for"), h.get("x-real-ip"));
  const userAgent = h.get("user-agent")?.trim() || undefined;
  return { ipAddress, userAgent };
}

async function resolveClientMeta(explicit?: Headers): Promise<{ ipAddress?: string; userAgent?: string }> {
  if (explicit) return clientMetaFromHeaders(explicit);
  try {
    const h = await headers();
    return clientMetaFromHeaders(h);
  } catch {
    return {};
  }
}

export type RecordAuditLogInput = {
  userId?: string | null;
  action: AuditAction | string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  headers?: Headers;
};

/** Prune expired rows roughly once in this many successful writes. */
const RETENTION_SWEEP_ODDS = 200;

/**
 * How long audit rows are kept. Every API read and sign-in writes a row, so the table
 * grows without bound unless something prunes it; anything that is not a positive integer
 * keeps the default. `0` is not accepted: an audit log that deletes itself is no log.
 */
export function resolveAuditRetentionDays(raw = process.env.AUDIT_LOG_RETENTION_DAYS): number {
  return resolveAuditRetention({ envRaw: raw, storedRaw: null }).value;
}

/**
 * The retention in effect: the env var, else the value saved under Server admin →
 * Operations, else the default. A failed settings read falls back to the env-only answer,
 * because housekeeping must not be what breaks.
 */
export async function effectiveAuditRetentionDays(prisma?: PrismaClient): Promise<number> {
  try {
    return await getAuditRetentionDays(prisma);
  } catch {
    return resolveAuditRetentionDays();
  }
}

async function maybePruneExpiredAuditRows(prisma: PrismaClient, random = Math.random) {
  if (Math.floor(random() * RETENTION_SWEEP_ODDS) !== 0) return;
  try {
    const cutoff = new Date(Date.now() - (await effectiveAuditRetentionDays(prisma)) * 24 * 60 * 60 * 1000);
    await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch {
    // Housekeeping must never fail the request it piggybacked on.
  }
}

export async function recordAuditLog(prisma: PrismaClient, input: RecordAuditLogInput): Promise<void> {
  const scrubbed = scrubAuditMetadata(input.metadata ?? undefined);
  let metadataJson: string | null = null;
  try {
    if (Object.keys(scrubbed).length > 0) metadataJson = JSON.stringify(scrubbed);
  } catch {
    metadataJson = null;
  }

  const { ipAddress, userAgent } = await resolveClientMeta(input.headers);

  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadataJson,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[audit-log] failed to persist audit entry", err);
    }
    return;
  }
  await maybePruneExpiredAuditRows(prisma);
}
