import { NextResponse } from "next/server";
import { banksForApp } from "@/lib/api-v1/banks";
import { authorizeAppDevice, NO_STORE } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/banks — the phone app's Banks screen: each connection, what it needs, and its
 * accounts with the app account each fills (`src/lib/api-v1/banks.ts`). Device tokens only.
 */
export async function GET(request: Request) {
  const authorized = await authorizeAppDevice(request, "banks");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await banksForApp(prisma, authorized.auth.user.id), { headers: NO_STORE });
}
