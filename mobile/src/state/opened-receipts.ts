import { Directory, File, Paths } from 'expo-file-system';

import { pdfReceiptFileName } from '@/utils/receipts';

/** Where a PDF waits while Quick Look shows it: the cache, which iOS may empty, never the backed-up documents. */
const OPENED = 'opened-receipts';

/**
 * The file to download a PDF receipt to. Only the one being opened is kept on the phone: this
 * deletes any opened before it (Quick Look shows one at a time), and signing out deletes the last.
 */
export function freshReceiptFile(attachmentId: string): File {
  forgetOpenedReceipts();
  const folder = new Directory(Paths.cache, OPENED);
  folder.create({ intermediates: true, idempotent: true });
  return new File(folder, pdfReceiptFileName(attachmentId));
}

/** Deletes any PDF receipt downloaded to be opened. Never throws. */
export function forgetOpenedReceipts() {
  try {
    const folder = new Directory(Paths.cache, OPENED);
    if (folder.exists) folder.delete();
  } catch {
    // Nothing kept, or iOS already emptied the cache.
  }
}
