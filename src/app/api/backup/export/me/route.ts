import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { buildUserBackupPayload } from "@/lib/backup";
import { prisma } from "@/lib/prisma";
import { requireUserApiUser } from "@/lib/session";

export async function GET() {
  const auth = await requireUserApiUser();
  if (auth.status === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // A login parked on the passkey wall must not be able to pull the whole account out
  // through the API with the very same cookie the wall is holding back.
  if (auth.status === 403) {
    return NextResponse.json({ error: "Passkey verification required" }, { status: 403 });
  }

  const user = auth.user;
  const payload = await buildUserBackupPayload(user.id);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const filename = `finance-tracker-backup-${stamp}.json`;

  const h = await headers();
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.user_backup_exported,
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
