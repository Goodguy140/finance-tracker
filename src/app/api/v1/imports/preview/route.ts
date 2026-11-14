import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { previewStatementFromApi } from "@/lib/api-v1/imports";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/imports/preview — `{ fileName, text }`: a statement's columns, its first rows and
 * the website form's guess at which column is which (`src/lib/api-v1/imports.ts`). Reads only;
 * nothing is saved. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "imports-preview");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = previewStatementFromApi(read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json(result.preview, { headers: NO_STORE });
}
