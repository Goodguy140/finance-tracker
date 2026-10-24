import type { PrismaClient } from "@prisma/client";

/**
 * Receipts kept with a transaction. Only images and PDFs, recognised from the file's own first
 * bytes: the browser's claimed type and the file name are not trusted, and nothing that could
 * run script in the page (SVG, HTML) is ever accepted, since files are served from this origin.
 */

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;
export const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf";

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return prefix.every((b, i) => bytes[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The file's real type, or null when it is not one we keep. */
export function sniffAttachmentType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  // HEIC/HEIF (iPhone photos): an ISO box whose brand names the format.
  if (startsWith(bytes, ascii("ftyp"), 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["heic", "heix", "hevc", "heif", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

/** A name safe to put in a Content-Disposition header and show in the page. */
export function cleanAttachmentName(name: string, contentType: string): string {
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    .trim()
    .slice(0, 120);
  if (base) return base;
  return contentType === "application/pdf" ? "receipt.pdf" : "receipt";
}

/**
 * `Content-Disposition` for serving a receipt. Header values must be Latin-1, so a name like
 * `收据.pdf` or one with an emoji made the response itself throw (a 500). Browsers that
 * understand `filename*` (all current ones) show the real name; the rest get an ASCII copy.
 */
export function attachmentContentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export type AttachmentRefusal = "empty" | "too-large" | "type" | "too-many" | "not-found";

export async function addAttachment(
  db: PrismaClient,
  input: { userId: string; transactionId: string; fileName: string; bytes: Uint8Array },
): Promise<{ ok: true; id: string } | { ok: false; reason: AttachmentRefusal }> {
  if (input.bytes.length === 0) return { ok: false, reason: "empty" };
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "too-large" };
  const contentType = sniffAttachmentType(input.bytes);
  if (!contentType) return { ok: false, reason: "type" };
  const owned = await db.transaction.findFirst({
    where: { id: input.transactionId, userId: input.userId },
    select: { _count: { select: { attachments: true } } },
  });
  if (!owned) return { ok: false, reason: "not-found" };
  if (owned._count.attachments >= MAX_ATTACHMENTS_PER_TRANSACTION) return { ok: false, reason: "too-many" };
  const row = await db.transactionAttachment.create({
    data: {
      userId: input.userId,
      transactionId: input.transactionId,
      fileName: cleanAttachmentName(input.fileName, contentType),
      contentType,
      sizeBytes: input.bytes.length,
      data: Buffer.from(input.bytes),
    },
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

/** The user's own attachment, still on one of their transactions, with its bytes. */
export function readAttachment(db: PrismaClient, userId: string, id: string) {
  return db.transactionAttachment.findFirst({
    where: { id, userId, transactionId: { not: null } },
    select: { fileName: true, contentType: true, data: true },
  });
}
