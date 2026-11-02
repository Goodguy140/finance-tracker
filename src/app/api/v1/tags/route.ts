import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/v1/tags — the user's tags, most used first, for a tag picker or `?tagId=`. Scope `accounts:read`. */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.accountsRead, "tags");
  if (!authorized.ok) return authorized.response;
  const tags = await prisma.tag.findMany({
    where: { userId: authorized.auth.user.id },
    select: { id: true, name: true, _count: { select: { transactions: true } } },
  });
  return NextResponse.json(
    {
      tags: tags
        .map((t) => ({ id: t.id, name: t.name, count: t._count.transactions }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },
    { headers: NO_STORE },
  );
}
