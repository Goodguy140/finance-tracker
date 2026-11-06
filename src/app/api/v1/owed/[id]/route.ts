import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { parsePaidBody } from "@/lib/api-v1/owed";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { setOwedSharePaid } from "@/lib/owed-to-you";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/owed/:id `{ "paid": true | false }` — marks what someone owes as paid back, or not,
 * as the website's Mark paid and Undo do. No total changes either way: the share came out of the
 * expense when it was marked as owed. 404 for a share that is not the user's. Scope `app`.
 */
export async function POST(request: Request, { params }: Params) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "owed-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = parsePaidBody(read.body);
  if (!parsed.ok) return apiError(parsed.error, 400);
  if (!(await setOwedSharePaid(prisma, authorized.auth.user.id, (await params).id, parsed.paid))) {
    return apiError("That owed amount no longer exists.", 404);
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
