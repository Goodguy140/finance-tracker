import { MAX_RECEIPT_BYTES, type ReceiptPhoto } from '@/utils/receipts';

/** What expo-sharing resolves a shared item to, as far as receipts need it. */
export type SharedItem = {
  contentType?: string | null;
  contentUri?: string | null;
  contentMimeType?: string | null;
  contentSize?: number | null;
  originalName?: string | null;
};

/**
 * Something shared to Finances from another app (Photos, Mail, Files) as a receipt to keep, or why
 * it can't be one. The server keeps photos and PDFs up to 8 MB (`src/lib/attachments.ts`) and reads
 * the real type from the bytes; the share sheet only offers Finances for one photo or PDF.
 */
export function receiptFromShare(item: SharedItem): { photo: ReceiptPhoto } | { error: string } {
  const mime = item.contentMimeType?.toLowerCase() ?? null;
  const pdf = mime === 'application/pdf' || (item.originalName?.toLowerCase().endsWith('.pdf') ?? false);
  const image = item.contentType === 'image' || (mime?.startsWith('image/') ?? false);
  if (!item.contentUri || (!pdf && !image)) {
    return { error: 'Finances can keep a photo or a PDF as a receipt.' };
  }
  if (item.contentSize && item.contentSize > MAX_RECEIPT_BYTES) {
    return { error: `That file is over ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB, the most a receipt can be.` };
  }
  const mimeType = pdf ? 'application/pdf' : mime && mime.startsWith('image/') ? mime : 'image/jpeg';
  const extension = pdf ? 'pdf' : mimeType === 'image/heic' ? 'heic' : mimeType === 'image/png' ? 'png' : 'jpg';
  const fileName = item.originalName?.trim() || `receipt.${extension}`;
  return { photo: { uri: item.contentUri, fileName, mimeType, sizeBytes: item.contentSize ?? null } };
}

/** The first shared item that can be a receipt, or why none can. */
export function receiptFromShares(items: readonly SharedItem[]): { photo: ReceiptPhoto } | { error: string } | null {
  if (items.length === 0) return null;
  let firstError: { error: string } | null = null;
  for (const item of items) {
    const result = receiptFromShare(item);
    if ('photo' in result) return result;
    firstError ??= result;
  }
  return firstError;
}

/** The receipt as route params for the Add sheet, and back: a file's place on this phone, by name. */
export type ReceiptParams = { receiptUri?: string; receiptName?: string; receiptType?: string; receiptSize?: string };

export function receiptParams(photo: ReceiptPhoto): Required<Omit<ReceiptParams, 'receiptSize'>> & Pick<ReceiptParams, 'receiptSize'> {
  return {
    receiptUri: photo.uri,
    receiptName: photo.fileName,
    receiptType: photo.mimeType,
    ...(photo.sizeBytes ? { receiptSize: String(photo.sizeBytes) } : {}),
  };
}

export function receiptFromParams(params: ReceiptParams): ReceiptPhoto | null {
  if (!params.receiptUri || !params.receiptName || !params.receiptType) return null;
  const size = params.receiptSize ? Number(params.receiptSize) : NaN;
  return {
    uri: params.receiptUri,
    fileName: params.receiptName,
    mimeType: params.receiptType,
    sizeBytes: Number.isFinite(size) && size > 0 ? size : null,
  };
}
