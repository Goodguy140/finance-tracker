import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { printFileName } from "@/lib/printables/format";
import { authFailure, printableResponse } from "@/lib/printables/respond";
import { loadSummaryData } from "@/lib/printables/summary-data";
import { renderSummaryPdf } from "@/lib/printables/summary-pdf";
import { prisma } from "@/lib/prisma";
import { requireUserApiUser } from "@/lib/session";

/** The printable financial summary as a PDF: `?period=` and `?tag=` as on Reports. */
export async function GET(request: NextRequest) {
  const auth = await requireUserApiUser();
  if (auth.status !== "ok") return authFailure(auth.status);
  const params = request.nextUrl.searchParams;
  const data = await loadSummaryData(auth.user, { period: params.get("period") ?? undefined, tag: params.get("tag") });
  const pdf = await renderSummaryPdf(data);

  await recordAuditLog(prisma, {
    userId: auth.user.id,
    action: AUDIT_ACTIONS.user_printable_downloaded,
    metadata: { kind: "summary", period: data.period.key, tagged: data.tagName !== null },
    headers: await headers(),
  });

  return printableResponse(pdf, {
    filename: printFileName(`financial-summary-${data.period.key}`, data.todayYmd, "pdf"),
    contentType: "application/pdf",
    inline: params.get("view") === "1",
  });
}
