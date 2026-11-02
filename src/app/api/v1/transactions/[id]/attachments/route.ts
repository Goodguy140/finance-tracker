import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/api-token";
import { authorizeApiRequest, NO_STORE } from "@/lib/api-v1/route-auth";
import { addAttachment, ATTACHMENT_REFUSAL_MESSAGES, MAX_ATTACHMENT_BYTES, type AttachmentRefusal } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Room for multipart's own wrapping around the largest receipt. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const STATUS: Record<AttachmentRefusal, number> = {
  empty: 400,
  "too-large": 413,
  type: 415,
  "too-many": 409,
  quota: 409,
  "not-found": 404,
};

/**
 * POST /api/v1/transactions/:id/attachments — keeps a receipt photo (or PDF) with one entry, sent
 * as `multipart/form-data` with the file in a field named `file`. The same checks as the website:
 * up to 8 MB, a photo or PDF recognised from its own bytes, at most 10 per entry and 500 MB per
 * account. 201 with the new receipt's id. Scope `app`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApiRequest(request, API_SCOPES.app, "attachments-write");
  if (!authorized.ok) return authorized.response;
  const { auth } = authorized;

  // A declared size too big is refused before the body is read at all.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: ATTACHMENT_REFUSAL_MESSAGES["too-large"] }, { status: 413, headers: NO_STORE });
  }
  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    // Not multipart: answered below.
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Send the receipt as multipart/form-data, in a field named 'file'." },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await addAttachment(prisma, {
    userId: auth.user.id,
    transactionId: (await params).id,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) {
    return NextResponse.json({ error: ATTACHMENT_REFUSAL_MESSAGES[result.reason] }, { status: STATUS[result.reason], headers: NO_STORE });
  }
  return NextResponse.json({ attachment: { id: result.id } }, { status: 201, headers: NO_STORE });
}
