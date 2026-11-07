import { API_SCOPES } from "@/lib/api-token";
import { investmentResponse, saveInvestmentFlowFromApi } from "@/lib/api-v1/investments";
import { authorizeApiRequest, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/investments/contributions `{ accountId, direction: "contribution"|"withdrawal",
 * amountCents, date, note?, overRoom? }` — records one, as the Investments card does. A
 * contribution that would go over its year's TFSA, RRSP or FHSA room is not saved: 409 with what
 * it would cost, until it is sent again with `overRoom: true`. 201 `{ id }`. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  return investmentResponse(await saveInvestmentFlowFromApi(prisma, authorized.auth.user.id, null, read.body), 201);
}
