import { describe, expect, it } from 'vitest';

import { isImageReceipt, MAX_RECEIPT_BYTES, pdfReceiptFileName, receiptFromAsset, receiptOpenError, receiptSize } from './receipts';

describe('receiptFromAsset', () => {
  it('names a camera photo, which comes without a name, and keeps a library photo’s own', () => {
    expect(receiptFromAsset({ uri: 'file:///a.jpg', fileName: null, mimeType: 'image/jpeg', fileSize: 900_000 })).toEqual({
      photo: { uri: 'file:///a.jpg', fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 900_000 },
    });
    expect(receiptFromAsset({ uri: 'file:///b', fileName: 'IMG_0042.HEIC', mimeType: 'image/heic' })).toEqual({
      photo: { uri: 'file:///b', fileName: 'IMG_0042.HEIC', mimeType: 'image/heic', sizeBytes: null },
    });
  });

  it('sends anything not claimed as an image as a JPEG, leaving the server to check the bytes', () => {
    expect(receiptFromAsset({ uri: 'file:///c', mimeType: 'video/quicktime' })).toMatchObject({
      photo: { mimeType: 'image/jpeg', fileName: 'receipt.jpg' },
    });
  });

  it('refuses a photo bigger than the server keeps', () => {
    expect(receiptFromAsset({ uri: 'file:///d', fileSize: MAX_RECEIPT_BYTES + 1 })).toHaveProperty('error');
    expect(receiptFromAsset({ uri: 'file:///d', fileSize: MAX_RECEIPT_BYTES })).toHaveProperty('photo');
  });
});

describe('receipt display', () => {
  it('shows photos itself and sizes in KB or MB', () => {
    expect(isImageReceipt('image/heic')).toBe(true);
    expect(isImageReceipt('application/pdf')).toBe(false);
    expect(receiptSize(340 * 1024)).toBe('340 KB');
    expect(receiptSize(200)).toBe('1 KB');
    expect(receiptSize(1.25 * 1024 * 1024)).toBe('1.3 MB');
  });
});

describe('opening a PDF receipt', () => {
  it('downloads it under its id with a .pdf name, which is how Quick Look knows it is a PDF', () => {
    expect(pdfReceiptFileName('cmb4x9k2q0001abcd')).toBe('cmb4x9k2q0001abcd.pdf');
  });

  it('never lets an id name a path outside the folder', () => {
    expect(pdfReceiptFileName('../../Documents/session')).toBe('______Documents_session.pdf');
    expect(pdfReceiptFileName('')).toBe('receipt.pdf');
  });

  it('says why it would not open, from the download’s error', () => {
    expect(receiptOpenError(new Error('Unable to download file: response has status 404'))).toMatch(/no longer on the entry/);
    expect(receiptOpenError(new Error('Unable to download file: response has status 401'))).toMatch(/Sign in again/);
    expect(receiptOpenError(new Error('The Internet connection appears to be offline.'))).toMatch(/connection/);
    expect(receiptOpenError('not an error')).toMatch(/connection/);
  });
});
