import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { ruleRefusal } from "@/lib/api-v1/recurring-rules";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";
import { cancelSubscription } from "@/lib/recurring-rules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/recurring/:id/cancel — "Cancel subscription": the person cancelled the bill with
 * the provider. The rule is turned off and the day kept, so Insights shows what it saves. 404 for
 * anything but one of the person's bills. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "recurring-write");
  if (!authorized.ok) return authorized.response;
  try {
    await cancelSubscription(prisma, authorized.auth.user.id, (await params).id);
  } catch (err) {
    const refused = ruleRefusal(err);
    return apiError(refused.error, refused.status);
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
