import { describe, expect, it } from 'vitest';

import { MAX_RECEIPT_BYTES } from '@/utils/receipts';
import { receiptFromParams, receiptFromShare, receiptFromShares, receiptParams } from '@/utils/shared-receipt';

describe('receiptFromShare', () => {
  it('keeps a shared photo with its name and type', () => {
    expect(
      receiptFromShare({ contentType: 'image', contentUri: 'file:///g/IMG_1.HEIC', contentMimeType: 'image/heic', contentSize: 2048, originalName: 'IMG_1.HEIC' }),
    ).toEqual({ photo: { uri: 'file:///g/IMG_1.HEIC', fileName: 'IMG_1.HEIC', mimeType: 'image/heic', sizeBytes: 2048 } });
  });

  it('keeps a PDF from Mail, even when its type comes only from the name', () => {
    expect(receiptFromShare({ contentType: 'file', contentUri: 'file:///g/a.pdf', contentMimeType: null, originalName: 'Invoice.PDF' })).toEqual({
      photo: { uri: 'file:///g/a.pdf', fileName: 'Invoice.PDF', mimeType: 'application/pdf', sizeBytes: null },
    });
  });

  it('names an unnamed photo by its type', () => {
    const result = receiptFromShare({ contentType: 'image', contentUri: 'file:///g/x', contentMimeType: 'image/png' });
    expect(result).toMatchObject({ photo: { fileName: 'receipt.png', mimeType: 'image/png' } });
  });

  it('refuses what the server would: other files, and anything over the size limit', () => {
    expect(receiptFromShare({ contentType: 'file', contentUri: 'file:///g/a.zip', contentMimeType: 'application/zip' })).toHaveProperty('error');
    expect(receiptFromShare({ contentType: 'website', contentUri: 'https://example.com' })).toHaveProperty('error');
    expect(receiptFromShare({ contentType: 'image', contentUri: null })).toHaveProperty('error');
    expect(
      receiptFromShare({ contentType: 'image', contentUri: 'file:///g/big.jpg', contentMimeType: 'image/jpeg', contentSize: MAX_RECEIPT_BYTES + 1 }),
    ).toEqual({ error: 'That file is over 8 MB, the most a receipt can be.' });
  });
});

describe('receiptFromShares', () => {
  it('takes the first item that can be a receipt, else the first reason none can', () => {
    const text = { contentType: 'text', contentUri: null };
    const photo = { contentType: 'image', contentUri: 'file:///g/p.jpg', contentMimeType: 'image/jpeg' };
    expect(receiptFromShares([text, photo])).toMatchObject({ photo: { uri: 'file:///g/p.jpg' } });
    expect(receiptFromShares([text])).toHaveProperty('error');
    expect(receiptFromShares([])).toBeNull();
  });
});

describe('receipt route params', () => {
  it('carry a receipt to the Add sheet and back unchanged', () => {
    const photo = { uri: 'file:///g/p.jpg', fileName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1234 };
    expect(receiptFromParams(receiptParams(photo))).toEqual(photo);
    expect(receiptFromParams(receiptParams({ ...photo, sizeBytes: null }))).toEqual({ ...photo, sizeBytes: null });
    expect(receiptFromParams({ receiptUri: 'file:///g/p.jpg' })).toBeNull();
  });
});
