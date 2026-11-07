import { API_SCOPES } from "@/lib/api-token";
import { investmentResponse, saveInvestmentValueFromApi } from "@/lib/api-v1/investments";
import { authorizeApiRequest, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST /api/v1/investments/values `{ accountId, totalValueCents, date, note? }` — a portfolio value on a day. 201 `{ id }`. Scope `app`. */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  return investmentResponse(await saveInvestmentValueFromApi(prisma, authorized.auth.user.id, null, read.body), 201);
}
