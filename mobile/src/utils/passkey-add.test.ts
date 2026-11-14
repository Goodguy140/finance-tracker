import { describe, expect, it } from 'vitest';

import { addPasskeyReady, passkeyLine, readCreationOptions, registrationResponse, tidyCode, tidyPasskeyName } from './passkey-add';

const ready = { nativeReady: true, homeServer: true, data: { proof: 'face-id' as const, appLinking: true } };

describe('whether the phone can add a passkey', () => {
  it('asks for what the server wants first when everything is in place', () => {
    expect(addPasskeyReady(ready)).toEqual({ ok: true, proof: 'face-id' });
    expect(addPasskeyReady({ ...ready, data: { proof: 'code', appLinking: true } })).toEqual({ ok: true, proof: 'code' });
  });

  it('says why not, off the home server, on an older build, without the app link, or with no factor yet', () => {
    expect(addPasskeyReady({ ...ready, homeServer: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/built for/) });
    expect(addPasskeyReady({ ...ready, nativeReady: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/TestFlight/) });
    expect(addPasskeyReady({ ...ready, data: { proof: 'face-id', appLinking: false } })).toMatchObject({ ok: false, reason: expect.stringMatching(/APPLE_APP_ID/) });
    expect(addPasskeyReady({ ...ready, data: { proof: null, appLinking: true } })).toMatchObject({ ok: false, reason: expect.stringMatching(/first passkey on the website/) });
  });
});

describe('what is typed', () => {
  it('keeps a name of 1 to 40 characters', () => {
    expect(tidyPasskeyName("  Sam's   iPhone ")).toBe("Sam's iPhone");
    expect(tidyPasskeyName('   ')).toBeNull();
    expect(tidyPasskeyName('x'.repeat(50))).toHaveLength(40);
  });

  it('takes an authenticator code only once it is six digits', () => {
    expect(tidyCode('123 456')).toBe('123456');
    expect(tidyCode('12345')).toBeNull();
    expect(tidyCode('12345a')).toBeNull();
  });
});

describe('talking to iOS and the server', () => {
  it("turns the server's creation options into what Swift reads: standard base64, the account's passkeys excluded", () => {
    const body = {
      challengeId: 'ch1',
      options: {
        challenge: 'q-_w',
        rp: { id: 'money.example.com', name: 'Finance Tracker' },
        user: { id: 'dXNlcjE', name: 'sam@example.test', displayName: 'Sam' },
        excludeCredentials: [{ id: 'aGk-', type: 'public-key' }],
      },
    };
    expect(readCreationOptions(body)).toEqual({
      challengeId: 'ch1',
      rpId: 'money.example.com',
      challenge: 'q+/w',
      userId: 'dXNlcjE=',
      userName: 'sam@example.test',
      excluded: ['aGk+'],
    });
    expect(readCreationOptions({ ...body, options: { ...body.options, rp: {} } })).toBeNull();
    expect(readCreationOptions({ options: body.options })).toBeNull();
  });

  it("sends iOS's new passkey back as a browser would, base64url throughout", () => {
    expect(registrationResponse({ credentialId: 'a+b/', clientDataJSON: 'eyJ9==', attestationObject: 'o+/=' })).toEqual({
      id: 'a-b_',
      rawId: 'a-b_',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: 'eyJ9', attestationObject: 'o-_', transports: ['internal', 'hybrid'] },
    });
  });

  it('describes each passkey by when it was added and last used', () => {
    expect(passkeyLine({ createdAt: '2026-11-14T02:00:00.000Z', lastUsedAt: null, synced: true }, 'en-US')).toBe('Added Nov 14, 2026 · not used yet · synced');
    expect(passkeyLine({ createdAt: '2026-10-01T02:00:00.000Z', lastUsedAt: '2026-11-02T10:00:00.000Z', synced: false }, 'en-US')).toBe(
      'Added Oct 1, 2026 · used Nov 2, 2026',
    );
  });
});
