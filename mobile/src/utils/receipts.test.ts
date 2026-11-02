import { describe, expect, it } from 'vitest';

import { isImageReceipt, MAX_RECEIPT_BYTES, receiptFromAsset, receiptSize } from './receipts';

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
