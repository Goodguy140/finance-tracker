import { API_SCOPES } from "@/lib/api-token";
import { countTransferFromApi, investmentResponse } from "@/lib/api-v1/investments";
import { authorizeApiRequest } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/investments/transfers/:id/count — Count toward room: records a contribution from a
 * transfer into a TFSA, RRSP or FHSA, once. 201 `{ id }` of the contribution. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments-write");
  if (!authorized.ok) return authorized.response;
  return investmentResponse(await countTransferFromApi(prisma, authorized.auth.user.id, (await params).id), 201);
}
