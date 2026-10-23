import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
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
