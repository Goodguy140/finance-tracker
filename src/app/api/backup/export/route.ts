import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { buildUserBackupPayload } from "@/lib/backup";
import { prisma } from "@/lib/prisma";
import { requireAdminApiUser } from "@/lib/session";

export async function GET() {
  const auth = await requireAdminApiUser();
  if (auth.status === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (auth.status === 403) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = auth.user;

  const payload = await buildUserBackupPayload(admin.id);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const filename = `finance-tracker-backup-${stamp}.json`;

  const h = await headers();
  await recordAuditLog(prisma, {
    userId: admin.id,
    action: AUDIT_ACTIONS.admin_backup_exported,
    metadata: { format: "json", scope: "user_snapshot" },
    headers: h,
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
