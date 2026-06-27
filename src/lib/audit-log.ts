import type { PrismaClient } from "@prisma/client";
import { headers } from "next/headers";

export const AUDIT_ACTIONS = {
  admin_oauth_settings_updated: "admin_oauth_settings_updated",
  user_password_changed: "user_password_changed",
  user_backup_imported: "user_backup_imported",
  financial_account_created: "financial_account_created",
  financial_account_archived: "financial_account_archived",
  financial_account_unarchived: "financial_account_unarchived",
  financial_account_deleted: "financial_account_deleted",
  user_account_deleted: "user_account_deleted",
  admin_backup_exported: "admin_backup_exported",
  user_backup_exported: "user_backup_exported",
  api_token_created: "api_token_created",
  api_token_revoked: "api_token_revoked",
  api_budgets_read: "api_budgets_read",
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

function parseForwardedIp(value: string | null): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  return first || undefined;
}

export function clientMetaFromHeaders(h: Headers): { ipAddress?: string; userAgent?: string } {
  const xff = h.get("x-forwarded-for");
  const ipAddress = parseForwardedIp(xff) || h.get("x-real-ip")?.trim() || undefined;
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
  }
}
