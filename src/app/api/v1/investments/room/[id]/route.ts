import { API_SCOPES } from "@/lib/api-token";
import { deleteRoomFromApi, investmentResponse } from "@/lib/api-v1/investments";
import { authorizeApiRequest } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/v1/investments/room/:id — removes an entered figure; TFSA and FHSA room is then estimated again. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments-write");
  if (!authorized.ok) return authorized.response;
  return investmentResponse(await deleteRoomFromApi(prisma, authorized.auth.user.id, (await params).id));
}
