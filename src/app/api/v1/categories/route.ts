import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { createCategoryFromApi, loadCategoryDetails } from "@/lib/api-v1/category-edits";
import { apiError, authorizeApiRequest, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/categories: names and ids for POST /api/v1/transactions. With `?details=1`, also
 * each one's `groupName`, `spendingRole` (need, want or null) and `uses` (entries, split parts,
 * recurring rules and plans in it), for Settings → Categories on the phone. Scope `accounts:read`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.accountsRead, "categories");
  if (!authorized.ok) return authorized.response;
  const userId = authorized.auth.user.id;

  if (new URL(request.url).searchParams.get("details") === "1") {
    return NextResponse.json({ categories: await loadCategoryDetails(prisma, userId) }, { headers: NO_STORE });
  }
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true },
  });
  return NextResponse.json(
    { categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind.toLowerCase() })) },
    { headers: NO_STORE },
  );
}

/**
 * POST /api/v1/categories — `{ name, kind: "expense" | "income", limitCents? }`, as Settings →
 * Categories' Add: refused when one of that kind already has the name; `limitCents` sets an
 * expense category's monthly budget from this month on. 201 with its `id`. Scope `app`.
 */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "categories-write");
  if (!authorized.ok) return authorized.response;
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const result = await createCategoryFromApi(prisma, authorized.auth.user, read.body);
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ id: result.id }, { status: 201, headers: NO_STORE });
}
