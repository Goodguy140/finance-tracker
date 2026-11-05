import { describe, expect, it } from 'vitest';

import { homeServerDomain } from '../../app.config';
import { isHomeServer } from '@/utils/home-server';
import { authenticationResponse, passkeyTokenRequestBody, readPasskeyOptions, readPasskeySignIn } from '@/utils/passkey-sign-in';

function base64(text: string) {
  return btoa(text);
}

describe('homeServerDomain', () => {
  it('is null when no home server is set, so the build signs in as before', () => {
    expect(homeServerDomain(undefined)).toBeNull();
    expect(homeServerDomain('  ')).toBeNull();
  });

  it('takes a domain or a pasted https address, lower-cased', () => {
    expect(homeServerDomain('Finances.Example.com')).toBe('finances.example.com');
    expect(homeServerDomain(' https://finances.example.com/ ')).toBe('finances.example.com');
  });

  it.each(['localhost', '192.168.1.20', 'finances.example.com:8443', 'http://finances.example.com', 'finances.example.com/app', 'bad_name.example.com'])(
    'stops the build for %s, which iOS cannot pair with',
    (raw) => {
      expect(() => homeServerDomain(raw)).toThrow(/HOME_SERVER_DOMAIN/);
    },
  );
});

describe('isHomeServer', () => {
  it('matches the home domain exactly', () => {
    expect(isHomeServer('https://finances.example.com', 'finances.example.com')).toBe(true);
    expect(isHomeServer('https://other.example.com', 'finances.example.com')).toBe(false);
    expect(isHomeServer('https://www.finances.example.com', 'finances.example.com')).toBe(false);
    expect(isHomeServer('https://finances.example.com:8443', 'finances.example.com')).toBe(false);
  });

  it('matches nothing in a build without a home server', () => {
    expect(isHomeServer('https://finances.example.com', null)).toBe(false);
  });
});

describe('readPasskeySignIn', () => {
  const info = { optionsPath: '/api/v1/app/passkey/options', tokenPath: '/api/v1/app/passkey/token', rpId: 'finances.example.com' };

  it('reads what a home server advertises', () => {
    expect(readPasskeySignIn({ service: 'finance-tracker', passkeySignIn: info })).toEqual(info);
  });

  it('is null for a server that offers none, or offers it oddly', () => {
    expect(readPasskeySignIn({ service: 'finance-tracker' })).toBeNull();
    expect(readPasskeySignIn({ passkeySignIn: { ...info, optionsPath: 'https://elsewhere.example/options' } })).toBeNull();
    expect(readPasskeySignIn({ passkeySignIn: { ...info, rpId: '' } })).toBeNull();
    expect(readPasskeySignIn(null)).toBeNull();
  });
});

describe('readPasskeyOptions', () => {
  it('reads the challenge and the domain it is for', () => {
    const body = { challengeId: 'c1', options: { challenge: 'q2-_', rpId: 'finances.example.com', allowCredentials: [] } };
    expect(readPasskeyOptions(body)).toEqual({ challengeId: 'c1', challenge: 'q2-_', rpId: 'finances.example.com' });
  });

  it('is null for a rate-limit answer or anything incomplete', () => {
    expect(readPasskeyOptions({ error: 'Too many sign-in attempts. Try again shortly.' })).toBeNull();
    expect(readPasskeyOptions({ challengeId: 'c1', options: { rpId: 'finances.example.com' } })).toBeNull();
  });
});

describe('authenticationResponse', () => {
  const assertion = {
    credentialId: base64('\xfb\xffcredential'),
    userId: base64('user-1'),
    authenticatorData: base64('auth data'),
    clientDataJSON: base64('{"type":"webauthn.get"}'),
    signature: base64('\xff\xfesig'),
  };

  it('is the JSON a browser sends, in base64url, with the credential id as id and rawId', () => {
    const response = authenticationResponse(assertion);
    expect(response).toEqual({
      id: '-_9jcmVkZW50aWFs',
      rawId: '-_9jcmVkZW50aWFs',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
        authenticatorData: 'YXV0aCBkYXRh',
        signature: '__5zaWc',
        userHandle: 'dXNlci0x',
      },
    });
  });

  it('leaves out the user handle when iOS returned none', () => {
    expect(authenticationResponse({ ...assertion, userId: '' }).response).not.toHaveProperty('userHandle');
  });

  it('is sent with the challenge it answers and the name of this phone', () => {
    const body = JSON.parse(
      passkeyTokenRequestBody({ challengeId: 'c1', assertion, deviceName: "Sam's iPhone", platform: 'ios', appVersion: null }),
    );
    expect(body).toEqual({
      challengeId: 'c1',
      response: authenticationResponse(assertion),
      device_name: "Sam's iPhone",
      platform: 'ios',
    });
  });
});
