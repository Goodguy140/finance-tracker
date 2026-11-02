import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { attachmentResponseHeaders, readAttachment } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/attachments/:id — one of the user's receipts, its bytes, served as the website
 * serves them. Scope `app`: the phone shows them; personal access tokens never see receipts.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "attachments-read");
  if (!authorized.ok) return authorized.response;
  const file = await readAttachment(prisma, authorized.auth.user.id, (await params).id);
  if (!file) return NextResponse.json({ error: "No receipt with that id." }, { status: 404, headers: NO_STORE });
  return new NextResponse(new Uint8Array(file.data), { headers: attachmentResponseHeaders(file) });
}

/**
 * DELETE /api/v1/attachments/:id — takes a receipt off its entry, as Remove does on the website.
 * 204. Scope `app`.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "attachments-write");
  if (!authorized.ok) return authorized.response;
  // Only one still on an entry: one parked with a deleted entry's undo record goes with that record.
  const removed = await prisma.transactionAttachment.deleteMany({
    where: { id: (await params).id, userId: authorized.auth.user.id, transactionId: { not: null } },
  });
  if (removed.count === 0) return NextResponse.json({ error: "No receipt with that id." }, { status: 404, headers: NO_STORE });
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
