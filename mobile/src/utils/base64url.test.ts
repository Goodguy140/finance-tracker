import { describe, expect, it } from 'vitest';

import { base64FromBase64Url, base64UrlFromBase64, base64UrlFromBytes } from '@/utils/base64url';

describe('base64UrlFromBytes', () => {
  it('matches btoa for every length, including the ones base64 pads', () => {
    for (let length = 0; length <= 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const reference = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(base64UrlFromBytes(bytes)).toBe(reference);
    }
  });

  it('uses - and _ where base64 has + and /', () => {
    expect(base64UrlFromBytes(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
});

describe('base64UrlFromBase64', () => {
  it('swaps the two characters and drops the padding', () => {
    expect(base64UrlFromBase64('+/+/ab==')).toBe('-_-_ab');
  });
});

describe('base64FromBase64Url', () => {
  it('round-trips with base64UrlFromBase64 for every length, putting the padding back', () => {
    for (let length = 0; length <= 40; length++) {
      const base64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(length))));
      expect(base64FromBase64Url(base64UrlFromBase64(base64))).toBe(base64);
    }
  });
});
