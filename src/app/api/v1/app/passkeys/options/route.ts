import { NextResponse } from "next/server";
import { readProof, startAppPasskey } from "@/lib/app-passkeys";
import { apiError, authorizeAppDevice, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/app/passkeys/options — `{ stepUp }` (Face ID with one of the account's passkeys)
 * or `{ code }` (its authenticator app), whichever `GET /api/v1/app/passkeys` asked for. Answers
 * a single-use registration challenge for iOS to make a passkey with. Device tokens only.
 */
export async function POST(request: Request) {
  const authorized = await authorizeAppDevice(request, "app-passkeys-write");
  if (!authorized.ok) return authorized.response;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const result = await startAppPasskey({ db: prisma }, authorized.auth.user, readProof(body.body));
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ challengeId: result.challengeId, options: result.options }, { headers: NO_STORE });
}
