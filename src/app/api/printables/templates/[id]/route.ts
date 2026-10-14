import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { printFileName } from "@/lib/printables/format";
import { authFailure, printableResponse } from "@/lib/printables/respond";
import { findTemplate, parseTemplateFormat, parseTemplateMode, templateCsv } from "@/lib/printables/templates";
import { loadTemplateSheet } from "@/lib/printables/templates-data";
import { renderTemplatePdf } from "@/lib/printables/templates-pdf";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { requireUserApiUser } from "@/lib/session";

/** One planning template: `?mode=filled|blank`, `?format=pdf|csv`, `?month=YYYY-MM` for monthly ones. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUserApiUser();
  if (auth.status !== "ok") return authFailure(auth.status);
  const template = findTemplate((await ctx.params).id);
  if (!template) return NextResponse.json({ error: "No such template" }, { status: 404 });

  const params = request.nextUrl.searchParams;
  const mode = parseTemplateMode(params.get("mode"));
  const format = parseTemplateFormat(params.get("format"));
  const todayYmd = currentYmdInTimeZone(auth.user.timezone);
  const sheet = await loadTemplateSheet(auth.user, template.id, mode, { month: params.get("month") });

  // Only a filled template carries the user's figures; a blank one is no more than a form.
  if (mode === "filled") {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.user_printable_downloaded,
      metadata: { kind: template.id, format },
      headers: await headers(),
    });
  }

  const base = `${template.id}-${mode === "blank" ? "blank" : "filled"}`;
  if (format === "csv") {
    // A byte-order mark so Excel reads the file as UTF-8 and keeps accented names intact.
    return printableResponse(`﻿${templateCsv(sheet)}\r\n`, {
      filename: printFileName(base, todayYmd, "csv"),
      contentType: "text/csv; charset=utf-8",
    });
  }
  return printableResponse(await renderTemplatePdf(sheet, { todayYmd }), {
    filename: printFileName(base, todayYmd, "pdf"),
    contentType: "application/pdf",
    inline: params.get("view") === "1",
  });
}
