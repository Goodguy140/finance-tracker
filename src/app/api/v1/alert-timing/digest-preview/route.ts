import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { apiError, authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { sendDigestPreview } from "@/lib/email-digest";

export const dynamic = "force-dynamic";

/** POST /api/v1/alert-timing/digest-preview — emails the latest digest now, as "Send me one now" does. Scope `app`. */
export async function POST(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "alert-timing-write");
  if (!authorized.ok) return authorized.response;
  const result = await sendDigestPreview(authorized.auth.user.id);
  if (result !== "sent") return apiError("The email could not be sent. SMTP may not be configured on the server.", 400);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
