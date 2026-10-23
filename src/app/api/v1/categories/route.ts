import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/v1/categories: names and ids for POST /api/v1/transactions. Scope `accounts:read`. */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.accountsRead, "categories");
  if (!authorized.ok) return authorized.response;

  const categories = await prisma.category.findMany({
    where: { userId: authorized.auth.user.id },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true },
  });
  return NextResponse.json(
    { categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind.toLowerCase() })) },
    { headers: NO_STORE },
  );
}
