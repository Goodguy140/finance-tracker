import { describe, expect, it } from 'vitest';

import { parseServerAddress } from '@/utils/server-address';

describe('parseServerAddress', () => {
  it('assumes https and keeps only the origin', () => {
    expect(parseServerAddress('  finances.example.com  ')).toEqual({ ok: true, origin: 'https://finances.example.com' });
    expect(parseServerAddress('https://finances.example.com:8443/login?x=1')).toEqual({
      ok: true,
      origin: 'https://finances.example.com:8443',
    });
  });

  it('refuses plain http and other schemes', () => {
    expect(parseServerAddress('http://finances.example.com')).toMatchObject({ ok: false });
    expect(parseServerAddress('ftp://finances.example.com')).toMatchObject({ ok: false });
  });

  it('refuses empty input and embedded credentials', () => {
    expect(parseServerAddress('   ')).toMatchObject({ ok: false });
    expect(parseServerAddress('https://sam:secret@finances.example.com')).toMatchObject({ ok: false });
  });
});
