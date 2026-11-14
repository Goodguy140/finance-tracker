/** The server's limits for receipts (`src/lib/attachments.ts`). */
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const MAX_RECEIPTS_PER_ENTRY = 10;

/** A photo picked to keep with an entry, ready to upload. */
export type ReceiptPhoto = { uri: string; fileName: string; mimeType: string; sizeBytes: number | null };

/**
 * The picker's asset as a photo to upload, or why it cannot be kept. A camera photo comes with no
 * name, and the type is the picker's claim only: the server reads the real one from the bytes.
 */
export function receiptFromAsset(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): { photo: ReceiptPhoto } | { error: string } {
  if (asset.fileSize && asset.fileSize > MAX_RECEIPT_BYTES) {
    return { error: `That photo is over ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB, the most a receipt can be.` };
  }
  const mimeType = asset.mimeType && asset.mimeType.startsWith('image/') ? asset.mimeType : 'image/jpeg';
  const extension = mimeType === 'image/heic' ? 'heic' : mimeType === 'image/png' ? 'png' : 'jpg';
  const fileName = asset.fileName?.trim() || `receipt.${extension}`;
  return { photo: { uri: asset.uri, fileName, mimeType, sizeBytes: asset.fileSize ?? null } };
}

/** Whether a receipt opens in the app's photo viewer; anything else is a PDF, for Quick Look. */
export function isImageReceipt(contentType: string): boolean {
  return contentType.startsWith('image/');
}

/** "1.2 MB", "340 KB". */
export function receiptSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The file a PDF receipt is downloaded to before Quick Look opens it. Quick Look goes by the
 * extension, and only the id's plain characters are used, so no id can name a path outside the folder.
 */
export function pdfReceiptFileName(attachmentId: string): string {
  return `${attachmentId.replace(/[^A-Za-z0-9_-]/g, '_') || 'receipt'}.pdf`;
}

/** What to say when a PDF receipt will not open. */
export function receiptOpenError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (/\b404\b/.test(message)) return 'This receipt is no longer on the entry. Close the entry and open it again.';
  if (/\b(401|403)\b/.test(message)) return 'Your server would not send this receipt. Sign in again and try once more.';
  return 'Couldn’t open this receipt. Check your connection and try again.';
}
