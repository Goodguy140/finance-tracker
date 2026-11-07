import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parseEnabledBody, ruleRefusal } from "@/lib/api-v1/recurring-rules";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";
import { setRecurringRuleEnabled } from "@/lib/recurring-rules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/recurring/:id/enabled `{ enabled }` — pauses a rule, or turns it back on (which
 * also undoes a "Cancel subscription"). Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const body = parseEnabledBody(read.body);
  if (!body.ok) return apiError(body.error, 400);
  try {
    await setRecurringRuleEnabled(prisma, authorized.auth.user.id, (await params).id, body.enabled);
  } catch (err) {
    const refused = ruleRefusal(err);
    return apiError(refused.error, refused.status);
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
