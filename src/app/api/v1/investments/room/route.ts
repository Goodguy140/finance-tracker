import { API_SCOPES } from "@/lib/api-token";
import { investmentResponse, setRoomFromApi } from "@/lib/api-v1/investments";
import { authorizeApiRequest, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PUT /api/v1/investments/room `{ accountType: "TFSA"|"RRSP"|"FHSA", year, roomCents }` — one
 * year's room from CRA, replacing any figure already entered for that year. Negative is allowed
 * (a TFSA statement shows an excess that way). Scope `app`.
 */
export async function PUT(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  return investmentResponse(await setRoomFromApi(prisma, authorized.auth.user.id, read.body));
}
