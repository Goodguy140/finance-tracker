import { describe, expect, it } from 'vitest';

import {
  authorizeUrl,
  describeTokenError,
  pkceChallenge,
  pkceVerifier,
  readRedirect,
  readServerInfo,
  readTokenResponse,
  REDIRECT_URI,
  tokenRequestBody,
} from '@/utils/sign-in';

const SERVER = {
  service: 'finance-tracker',
  api: 1,
  appSignIn: {
    authorizePath: '/app/authorize',
    tokenPath: '/api/v1/app/token',
    revokePath: '/api/v1/app/revoke',
    redirectUri: REDIRECT_URI,
  },
};

describe('PKCE', () => {
  // RFC 7636 appendix B: the server checks challenges the same way, so this pins both ends.
  const rfcBytes = new Uint8Array([
    116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240,
    91, 88, 5, 88, 83, 132, 141, 121,
  ]);

  it('makes the RFC 7636 verifier and S256 challenge', async () => {
    const verifier = pkceVerifier(rfcBytes);
    expect(verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const digest = btoa(String.fromCharCode(...hash));
    expect(pkceChallenge(digest)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('refuses fewer than 32 random bytes', () => {
    expect(() => pkceVerifier(new Uint8Array(31))).toThrow();
  });
});

describe('readServerInfo', () => {
  it('reads a Finance Tracker server', () => {
    expect(readServerInfo(SERVER)).toEqual({
      authorizePath: '/app/authorize',
      tokenPath: '/api/v1/app/token',
      revokePath: '/api/v1/app/revoke',
    });
  });

  it('refuses another service, another API version, or another redirect', () => {
    expect(readServerInfo({ ...SERVER, service: 'something-else' })).toBeNull();
    expect(readServerInfo({ ...SERVER, api: 2 })).toBeNull();
    expect(readServerInfo({ ...SERVER, appSignIn: { ...SERVER.appSignIn, redirectUri: 'other://x' } })).toBeNull();
    expect(readServerInfo('<html>')).toBeNull();
  });

  it('refuses paths that would send the sign-in to another host', () => {
    expect(readServerInfo({ ...SERVER, appSignIn: { ...SERVER.appSignIn, tokenPath: '//evil.example/token' } })).toBeNull();
    expect(
      readServerInfo({ ...SERVER, appSignIn: { ...SERVER.appSignIn, authorizePath: 'https://evil.example/' } }),
    ).toBeNull();
  });
});

describe('authorizeUrl', () => {
  it('asks for S256 and carries the state, device name and redirect', () => {
    const url = new URL(
      authorizeUrl('https://finances.example.com', readServerInfo(SERVER)!, {
        challenge: 'abc',
        state: 'xyz',
        deviceName: "Sam's iPhone",
      }),
    );
    expect(url.origin + url.pathname).toBe('https://finances.example.com/app/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'xyz',
      device: "Sam's iPhone",
      redirect_uri: REDIRECT_URI,
    });
  });
});

describe('readRedirect', () => {
  it('returns the code when the state matches', () => {
    expect(readRedirect(`${REDIRECT_URI}?code=c1&state=s1`, 's1')).toEqual({ ok: true, code: 'c1' });
  });

  it('ignores a code sent with another state', () => {
    expect(readRedirect(`${REDIRECT_URI}?code=c1&state=other`, 's1')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports a refusal', () => {
    expect(readRedirect(`${REDIRECT_URI}?error=access_denied&state=s1`, 's1')).toEqual({ ok: false, reason: 'denied' });
  });

  it('ignores another address or a missing code', () => {
    expect(readRedirect('financetracker://elsewhere?code=c1&state=s1', 's1')).toEqual({ ok: false, reason: 'invalid' });
    expect(readRedirect(`${REDIRECT_URI}?state=s1`, 's1')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('tokenRequestBody', () => {
  it('sends the code, verifier and redirect, and the version only when known', () => {
    const withVersion = new URLSearchParams(
      tokenRequestBody({ code: 'c', verifier: 'v', platform: 'ios', appVersion: '0.1.0' }),
    );
    expect(Object.fromEntries(withVersion)).toEqual({
      grant_type: 'authorization_code',
      code: 'c',
      code_verifier: 'v',
      redirect_uri: REDIRECT_URI,
      platform: 'ios',
      app_version: '0.1.0',
    });
    const without = new URLSearchParams(tokenRequestBody({ code: 'c', verifier: 'v', platform: 'ios', appVersion: null }));
    expect(without.has('app_version')).toBe(false);
  });
});

describe('readTokenResponse', () => {
  const good = {
    access_token: 'ftd_abc',
    token_type: 'Bearer',
    device: { id: 'dev1' },
    user: { displayName: 'Sam', email: 'sam@example.com' },
  };

  it('reads a device token', () => {
    expect(readTokenResponse(good)).toEqual({
      token: 'ftd_abc',
      deviceId: 'dev1',
      displayName: 'Sam',
      email: 'sam@example.com',
    });
  });

  it('refuses anything that is not a device token', () => {
    expect(readTokenResponse({ ...good, access_token: 'ft_abc' })).toBeNull();
    expect(readTokenResponse({ ...good, token_type: 'MAC' })).toBeNull();
    expect(readTokenResponse({ ...good, device: undefined })).toBeNull();
  });
});

describe('describeTokenError', () => {
  it("prefers the server's own description", () => {
    expect(describeTokenError(400, { error_description: 'That code has expired.' })).toBe('That code has expired.');
    expect(describeTokenError(429, {})).toMatch(/Too many/);
    expect(describeTokenError(500, null)).toMatch(/did not accept/);
  });
});
