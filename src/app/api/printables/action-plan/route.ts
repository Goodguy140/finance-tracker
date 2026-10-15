import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { actionPlanCsv, parsePlanRange } from "@/lib/printables/action-plan";
import { loadActionPlan } from "@/lib/printables/action-plan-data";
import { renderActionPlanPdf } from "@/lib/printables/action-plan-pdf";
import { printFileName } from "@/lib/printables/format";
import { authFailure, printableResponse } from "@/lib/printables/respond";
import { parseTemplateFormat, parseTemplateMode } from "@/lib/printables/templates";
import { prisma } from "@/lib/prisma";
import { requireUserApiUser } from "@/lib/session";

/**
 * The action plan: `?range=3|6|12|24` months (everything up to it), `?mode=filled|blank`,
 * `?format=pdf|csv`.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApiUser();
  if (auth.status !== "ok") return authFailure(auth.status);
  const params = request.nextUrl.searchParams;
  const mode = parseTemplateMode(params.get("mode"));
  const format = parseTemplateFormat(params.get("format"));
  const plan = await loadActionPlan(auth.user, mode, parsePlanRange(params.get("range")));

  if (mode === "filled") {
    await recordAuditLog(prisma, {
      userId: auth.user.id,
      action: AUDIT_ACTIONS.user_printable_downloaded,
      metadata: { kind: "action-plan", format, range: plan.range },
      headers: await headers(),
    });
  }

  const base = `action-plan-${plan.range}m-${mode}`;
  if (format === "csv") {
    return printableResponse(`﻿${actionPlanCsv(plan)}\r\n`, {
      filename: printFileName(base, plan.todayYmd, "csv"),
      contentType: "text/csv; charset=utf-8",
    });
  }
  return printableResponse(await renderActionPlanPdf(plan, mode === "filled" ? auth.user.displayName : null), {
    filename: printFileName(base, plan.todayYmd, "pdf"),
    contentType: "application/pdf",
    inline: params.get("view") === "1",
  });
}
