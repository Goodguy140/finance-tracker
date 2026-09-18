import type { Prisma, PrismaClient } from "@prisma/client";

export const AUDIT_PAGE_SIZE = 50;
/** Hard ceiling on an export, so one request cannot try to materialise the whole table. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

export type AuditLogFilters = {
  action: string | null;
  /** Matches the actor's email, case-insensitively and by substring. */
  actor: string | null;
  /** Inclusive `YYYY-MM-DD`, interpreted as UTC midnight. */
  from: string | null;
  /** Inclusive `YYYY-MM-DD`; the whole day is included. */
  to: string | null;
  page: number;
};

export type AuditLogRow = {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadataJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageCount: number;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseDateOnly(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value || !DATE_ONLY.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? null : value;
}

/**
 * Whitelist-or-default parsing of the filter query string. Never throws: a malformed
 * `?page=banana` shows page one rather than erroring the whole admin page.
 */
export function parseAuditLogSearchParams(
  params: Record<string, string | string[] | undefined>,
): AuditLogFilters {
  const page = Number.parseInt(firstParam(params.page)?.trim() ?? "", 10);
  return {
    action: firstParam(params.action)?.trim() || null,
    actor: firstParam(params.actor)?.trim() || null,
    from: parseDateOnly(firstParam(params.from)),
    to: parseDateOnly(firstParam(params.to)),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The filters as a Prisma `where`, ready to spread. Empty when nothing is filtered. */
export function auditLogWhere(filters: AuditLogFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.actor) where.user = { email: { contains: filters.actor } };

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
      // `to` is inclusive, so bound by the start of the next day rather than by 23:59:59 —
      // otherwise every event in the final second of the range is silently dropped.
      ...(filters.to ? { lt: new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
    };
  }
  return where;
}

function toRow(row: {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadataJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  user: { email: string } | null;
}): AuditLogRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorEmail: row.user?.email ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadataJson: row.metadataJson,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

const ROW_SELECT = {
  id: true,
  createdAt: true,
  action: true,
  targetType: true,
  targetId: true,
  metadataJson: true,
  ipAddress: true,
  userAgent: true,
  user: { select: { email: true } },
} as const;

/** One page of the audit log, newest first, plus the total for the pager. */
export async function queryAuditLog(
  prisma: PrismaClient,
  filters: AuditLogFilters,
  pageSize = AUDIT_PAGE_SIZE,
): Promise<AuditLogPage> {
  const where = auditLogWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      select: ROW_SELECT,
    }),
  ]);

  return {
    rows: rows.map(toRow),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Every matching row, newest first, capped. Used by the CSV export. */
export async function queryAuditLogForExport(
  prisma: PrismaClient,
  filters: AuditLogFilters,
  limit = AUDIT_EXPORT_MAX_ROWS,
): Promise<AuditLogRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: auditLogWhere(filters),
    orderBy: { createdAt: "desc" },
    take: limit,
    select: ROW_SELECT,
  });
  return rows.map(toRow);
}

/** Distinct actions present in the log, for the filter dropdown. */
export async function listAuditActionsInUse(prisma: PrismaClient): Promise<string[]> {
  const groups = await prisma.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } });
  return groups.map((g) => g.action);
}
