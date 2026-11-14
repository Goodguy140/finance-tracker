import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { importStatementFromApi } from "@/lib/api-v1/imports";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/imports — `{ fileName, text, mapping, accountId, categoryId, amountSign?, moneyIn?,
 * incomeCategoryId? }`: books a statement as the website's file import does, and answers what it
 * did (`imported`, `income`, `duplicates`, `unreadableDates`, `unreadableAmounts`). Rows already
 * in the log are skipped, so sending the same file again adds nothing. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "imports");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await importStatementFromApi(prisma, authorized.auth.user.id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json(result.summary, { headers: NO_STORE });
}
