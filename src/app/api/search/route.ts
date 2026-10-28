import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { previewQuickAdd } from "@/lib/search/quick-add-server";
import { searchUserData } from "@/lib/search/search-data";
import { requireUserApiUser } from "@/lib/session";

/** Longer than anyone types into a search box; keeps a pasted essay out of six LIKE scans. */
const MAX_QUERY_LENGTH = 100;

/**
 * The master search's data. With no `q` it answers only what decides which fixed entries the
 * palette offers (admin pages, Sync banks); with one, the user's matching data, grouped, and
 * the expense it would add when it reads as one ("12.50 tim hortons yesterday").
 */
export async function GET(request: Request) {
  const auth = await requireUserApiUser();
  if (auth.status === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (auth.status === 403) {
    return NextResponse.json({ error: "Passkey verification required" }, { status: 403 });
  }
  const user = auth.user;
  const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);

  const [results, bankCount, quickAdd] = await Promise.all([
    searchUserData(prisma, user, query),
    prisma.plaidItem.count({ where: { userId: user.id } }),
    previewQuickAdd(prisma, user, query),
  ]);

  return NextResponse.json(
    {
      ...results,
      quickAdd,
      context: { isAdmin: user.role === UserRole.SERVER_ADMIN, hasBanks: bankCount > 0 },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
