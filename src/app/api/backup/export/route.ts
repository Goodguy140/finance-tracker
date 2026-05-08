import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { buildUserBackupPayload } from "@/lib/backup";

export async function GET() {
  const session = await getCurrentSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await buildUserBackupPayload(userId);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const filename = `finance-tracker-backup-${stamp}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
