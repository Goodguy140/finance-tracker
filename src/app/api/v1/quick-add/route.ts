import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { currentYmdInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";
import { parseQuickAdd } from "@/lib/search/quick-add";
import { previewQuickAdd } from "@/lib/search/quick-add-server";

export const dynamic = "force-dynamic";

/** Longer than anything the reader would take as an add. */
const MAX_TEXT_LENGTH = 200;

/**
 * GET /api/v1/quick-add?text=12.50%20coffee%20yesterday — what the phone's search offers to add
 * for the text typed, as saving it would book it: the amount, title and date read from the text,
 * and the category and account the user's rules and past titles fill in, or as a transfer when a
 * "Mark as transfer" rule matches. `entry` is the text as read, before any rule renames it: what
 * to post to `POST /api/v1/transactions` as an expense, which applies the rules again as it saves.
 * Both null when the text is not an expense to add. The same reading the website's master search
 * shows. Scope `app`.
 */
export async function GET(request: Request) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "quick-add");
  if (!authorized.ok) return authorized.response;
  const text = new URL(request.url).searchParams.get("text") ?? "";
  const { user } = authorized.auth;
  const entry = text.length > MAX_TEXT_LENGTH ? null : parseQuickAdd(text, currentYmdInTimeZone(user.timezone));
  const preview = entry ? await previewQuickAdd(prisma, user, text) : null;
  return NextResponse.json({ preview, entry: preview ? entry : null }, { headers: NO_STORE });
}
