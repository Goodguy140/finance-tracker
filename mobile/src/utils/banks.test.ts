import { describe, expect, it } from 'vitest';

import {
  accountChoices,
  bankAccountLabel,
  describeLinkFinish,
  linkingInApp,
  readLinkFinish,
  readLinkStart,
  unmatchedCount,
} from './banks';

const ready = { available: true, appLinking: true, hasPasskey: true };

describe('linkingInApp', () => {
  it('connects banks in the app only on the home server, with Face ID set up on both sides', () => {
    expect(linkingInApp({ nativeReady: true, homeServer: true, data: ready })).toEqual({ ok: true });

    const reasons = [
      linkingInApp({ nativeReady: true, homeServer: true, data: { ...ready, available: false } }),
      linkingInApp({ nativeReady: false, homeServer: true, data: ready }),
      linkingInApp({ nativeReady: true, homeServer: false, data: ready }),
      linkingInApp({ nativeReady: true, homeServer: true, data: { ...ready, appLinking: false } }),
      linkingInApp({ nativeReady: true, homeServer: true, data: { ...ready, hasPasskey: false } }),
    ].map((r) => (r.ok ? null : r.reason));

    expect(reasons[0]).toMatch(/not set up on this server/);
    expect(reasons[1]).toMatch(/version of the app/);
    expect(reasons[2]).toMatch(/isn't the server this app was built for/);
    expect(reasons[3]).toMatch(/APPLE_APP_ID/);
    expect(reasons[4]).toMatch(/Add a passkey/);
  });
});

describe('accountChoices', () => {
  const accounts = [
    { id: 'a', name: 'Chequing', currency: 'CAD' },
    { id: 'b', name: 'US dollars', currency: 'USD' },
  ];

  it('offers only accounts in the bank account’s currency, or all when the bank did not say', () => {
    expect(accountChoices({ currency: 'cad' }, accounts).map((a) => a.id)).toEqual(['a']);
    expect(accountChoices({ currency: null }, accounts).map((a) => a.id)).toEqual(['a', 'b']);
    expect(accountChoices({ currency: 'EUR' }, accounts)).toEqual([]);
  });
});

describe('bank account rows', () => {
  it('labels with the last digits and counts the accounts that sync nowhere yet', () => {
    expect(bankAccountLabel({ name: 'Chequing', mask: '1234' })).toBe('Chequing ••1234');
    expect(bankAccountLabel({ name: 'Savings', mask: null })).toBe('Savings');
    const row = { id: 'x', name: 'n', mask: null, currency: 'CAD' };
    expect(unmatchedCount({ accounts: [{ ...row, accountId: null }, { ...row, accountId: 'a' }, { ...row, accountId: null }] })).toBe(2);
  });
});

describe('reading the server’s answers', () => {
  it('needs a link id and token to open Plaid', () => {
    expect(readLinkStart({ linkId: 'l1', linkToken: 'link-sandbox-1', cutoffNote: 'From Aug 7' })).toEqual({
      linkId: 'l1',
      linkToken: 'link-sandbox-1',
      cutoffNote: 'From Aug 7',
    });
    expect(readLinkStart({ linkId: 'l1' })).toBeNull();
    expect(readLinkStart({ linkId: '', linkToken: 'x' })).toBeNull();
    expect(readLinkStart(null)).toBeNull();
  });

  it('tells a new connection from a fixed one, and rejects anything else', () => {
    const linked = { kind: 'linked', plaidItemId: 'p', institutionName: 'Tangerine', accountCount: 1, cutoffDisplay: 'Aug 7, 2026' };
    const updated = { kind: 'updated', plaidItemId: 'p', institutionName: 'Tangerine', newAccounts: 0 };
    expect(readLinkFinish(linked)).toEqual(linked);
    expect(readLinkFinish(updated)).toEqual(updated);
    expect(readLinkFinish({ ...linked, accountCount: '1' })).toBeNull();
    expect(readLinkFinish({ ...updated, kind: 'removed' })).toBeNull();
    expect(readLinkFinish({ ok: true })).toBeNull();
  });

  it('says what happened in words', () => {
    expect(describeLinkFinish({ kind: 'linked', plaidItemId: 'p', institutionName: 'Tangerine', accountCount: 1, cutoffDisplay: 'x' })).toMatch(
      /^Tangerine is connected with 1 account\. Choose where/,
    );
    expect(describeLinkFinish({ kind: 'updated', plaidItemId: 'p', institutionName: 'Tangerine', newAccounts: 0 })).toBe(
      'Tangerine is working again.',
    );
    expect(describeLinkFinish({ kind: 'updated', plaidItemId: 'p', institutionName: 'Tangerine', newAccounts: 2 })).toMatch(
      /^Tangerine now shares 2 more accounts\./,
    );
  });
});
