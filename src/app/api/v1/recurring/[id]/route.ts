import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { ruleRefusal, updateRuleFromApi } from "@/lib/api-v1/recurring-rules";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";
import { deleteRecurringRule } from "@/lib/recurring-rules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/v1/recurring/:id — replaces the rule's fields; the body is as for POST. Scope `app`. */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await updateRuleFromApi(prisma, authorized.auth.user.id, (await params).id, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { headers: NO_STORE });
}

/** DELETE /api/v1/recurring/:id — deletes the rule; what it posted stays in the log. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring-write");
  if (!authorized.ok) return authorized.response;
  try {
    await deleteRecurringRule(prisma, authorized.auth.user.id, (await params).id);
  } catch (err) {
    const refused = ruleRefusal(err);
    return apiError(refused.error, refused.status);
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
