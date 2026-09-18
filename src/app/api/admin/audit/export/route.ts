import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  AUDIT_EXPORT_MAX_ROWS,
  parseAuditLogSearchParams,
  queryAuditLogForExport,
} from "@/lib/admin-audit-query";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { toCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import { requireAdminApiUser } from "@/lib/session";

const COLUMNS = [
  "timestamp",
  "actor_email",
  "action",
  "target_type",
  "target_id",
  "metadata",
  "ip_address",
  "user_agent",
] as const;

export async function GET(request: Request) {
  const auth = await requireAdminApiUser();
  if (auth.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.status === 403) {
    const code = auth.reason === "mfa_required" ? "MFA required" : "Forbidden";
    return NextResponse.json({ error: code }, { status: 403 });
  }

  const url = new URL(request.url);
  const filters = parseAuditLogSearchParams(Object.fromEntries(url.searchParams.entries()));
  const rows = await queryAuditLogForExport(prisma, filters);

  const csv = toCsv(
    COLUMNS,
    rows.map((row) => [
      row.createdAt,
      row.actorEmail,
      row.action,
      row.targetType,
      row.targetId,
      row.metadataJson,
      row.ipAddress,
      row.userAgent,
    ]),
  );

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const filename = `finance-tracker-audit-${stamp}.csv`;

  // Recorded before the response is built, and deliberately includes the filter: an export
  // is itself an access to everyone's activity, and a review should see who took a copy.
  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.admin_audit_exported,
    metadata: {
      rows: rows.length,
      truncated: rows.length === AUDIT_EXPORT_MAX_ROWS,
      filters: {
        action: filters.action,
        actor: filters.actor,
        from: filters.from,
        to: filters.to,
      },
    },
    headers: await headers(),
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
