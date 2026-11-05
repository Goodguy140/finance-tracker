import { NextResponse } from "next/server";
import { authorizeAppDevice, NO_STORE } from "@/lib/api-v1/route-auth";
import { createAuthenticationOptions } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/app/step-up/options — a single-use passkey challenge for the signed-in user, which
 * the phone app signs with Face ID before something the website would ask "Confirm it's you" for
 * (connecting a bank: `src/lib/app-bank-link.ts`). Device tokens only.
 */
export async function POST(request: Request) {
  const authorized = await authorizeAppDevice(request, "app-step-up");
  if (!authorized.ok) return authorized.response;
  const { challengeId, options } = await createAuthenticationOptions("authenticate", authorized.auth.user.id);
  return NextResponse.json({ challengeId, options }, { headers: NO_STORE });
}
