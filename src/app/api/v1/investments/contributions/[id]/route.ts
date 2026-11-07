import { API_SCOPES } from "@/lib/api-token";
import { deleteInvestmentEntryFromApi, investmentResponse, saveInvestmentFlowFromApi } from "@/lib/api-v1/investments";
import { authorizeApiRequest, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/v1/investments/contributions/:id — the same body as POST; one counted from a transfer keeps that link. Scope `app`. */
export async function PATCH(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  return investmentResponse(await saveInvestmentFlowFromApi(prisma, authorized.auth.user.id, (await params).id, read.body));
}

/** DELETE /api/v1/investments/contributions/:id — one counted from a transfer leaves that transfer countable again. Scope `app`. */
export async function DELETE(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "investments-write");
  if (!authorized.ok) return authorized.response;
  return investmentResponse(await deleteInvestmentEntryFromApi(prisma, authorized.auth.user.id, "flow", (await params).id));
}
