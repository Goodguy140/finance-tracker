import { NextResponse } from "next/server";
import { finishAppPasskey, loadAppPasskeys } from "@/lib/app-passkeys";
import { apiError, authorizeAppDevice, NO_STORE, readJsonBody } from "@/lib/api-v1/route-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/app/passkeys — the account's passkeys, and what adding one from the phone asks
 * for first (`proof`: "face-id", "code", or null when the first is added on the website).
 * Device tokens only.
 */
export async function GET(request: Request) {
  const authorized = await authorizeAppDevice(request, "app-passkeys-read");
  if (!authorized.ok) return authorized.response;
  return NextResponse.json(await loadAppPasskeys(prisma, authorized.auth.user.id), { headers: NO_STORE });
}

/**
 * POST /api/v1/app/passkeys — `{ challengeId, response, name }`: keeps the passkey iOS made for
 * the challenge from `POST /api/v1/app/passkeys/options` (`src/lib/app-passkeys.ts`). 201 with
 * `{ passkey }`. Device tokens only.
 */
export async function POST(request: Request) {
  const authorized = await authorizeAppDevice(request, "app-passkeys-write");
  if (!authorized.ok) return authorized.response;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const fields = (body.body && typeof body.body === "object" ? body.body : {}) as Record<string, unknown>;
  const result = await finishAppPasskey(
    { db: prisma },
    { userId: authorized.auth.user.id, challengeId: fields.challengeId, response: fields.response, name: fields.name, headers: request.headers },
  );
  if (!result.ok) return apiError(result.error, result.status);
  return NextResponse.json({ passkey: result.passkey }, { status: 201, headers: NO_STORE });
}
