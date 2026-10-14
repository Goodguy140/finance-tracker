import { NextResponse } from "next/server";

/**
 * A finished printable as a download. `inline` lets the browser open a PDF in its own viewer,
 * where printing is one step; a CSV is always an attachment.
 */
export function printableResponse(
  body: Uint8Array | string,
  options: { filename: string; contentType: string; inline?: boolean },
): NextResponse {
  return new NextResponse(typeof body === "string" ? body : Buffer.from(body), {
    headers: {
      "Content-Type": options.contentType,
      "Content-Disposition": `${options.inline ? "inline" : "attachment"}; filename="${options.filename}"`,
      // Personal financial figures: never kept by a shared cache or the browser's.
      "Cache-Control": "no-store",
    },
  });
}

export function authFailure(status: 401 | 403): NextResponse {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Passkey verification required" },
    { status },
  );
}
