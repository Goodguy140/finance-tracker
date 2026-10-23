import { NextResponse } from "next/server";
import { readAttachment } from "@/lib/attachments";
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

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Files are served from the app's own origin: an image page may load nothing but itself.
      // (A PDF is shown by the browser's own viewer, which a sandbox would block.)
      ...(file.contentType === "application/pdf"
        ? {}
        : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    },
  });
}
