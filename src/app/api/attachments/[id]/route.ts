import { NextResponse } from "next/server";
import { attachmentResponseHeaders, readAttachment } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";
import { requireUserApiUser } from "@/lib/session";

/** One of the signed-in user's receipts, shown in the browser. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserApiUser();
  if (auth.status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Passkey verification required" }, { status: 403 });

  const { id } = await params;
  const file = await readAttachment(prisma, auth.user.id, id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.data), { headers: attachmentResponseHeaders(file) });
}
