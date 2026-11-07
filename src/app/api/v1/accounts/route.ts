import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { createAccountFromApi } from "@/lib/api-v1/account-edits";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { ymdFromDateUtc } from "@/lib/date-only";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/v1/accounts: every account with its latest recorded balance. Scope `accounts:read`. */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.accountsRead, "accounts");
  if (!authorized.ok) return authorized.response;
  const userId = authorized.auth.user.id;

  const accounts = await prisma.account.findMany({
    where: { userId },
    orderBy: [{ archived: "asc" }, { name: "asc" }],
    include: { balanceSnapshots: { orderBy: { date: "desc" }, take: 1 } },
  });
  return NextResponse.json(
    {
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        archived: a.archived,
        latestBalance: a.balanceSnapshots[0]
          ? { cents: a.balanceSnapshots[0].balanceCents, date: ymdFromDateUtc(a.balanceSnapshots[0].date) }
          : null,
      })),
    },
    { headers: NO_STORE },
  );
}

/**
 * POST /api/v1/accounts `{ name, type }` — adds an account, as Settings → Accounts does: in the
 * home currency, counted as savings when its type usually is. 201 `{ id }`. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "accounts-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await createAccountFromApi(prisma, authorized.auth.user, read.body, request.headers);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { status: 201, headers: NO_STORE });
}
