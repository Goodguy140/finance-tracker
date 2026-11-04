import { describe, expect, it } from 'vitest';

import { ApiError, SignedOutError } from '@/api/client';

import { applyOutcome, failureOutcome, outboxLine, pendingLabel, readOutbox, sendable, type PendingAdd } from './outbox';

function pending(overrides: Partial<PendingAdd> = {}): PendingAdd {
  return {
    key: 'k1-0123456789abcdef',
    body: { type: 'expense', amountCents: 1_250, title: 'Coffee' },
    label: '$12.50 Coffee',
    savedAt: '2026-11-03T12:00:00.000Z',
    photo: null,
    transactionId: null,
    error: null,
    ...overrides,
  };
}

const photo = { uri: 'k1-0123456789abcdef.jpg', fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 1_000 };

describe('failureOutcome', () => {
  it('keeps for later what never reached the server or found it down, busy or rate limited', () => {
    expect(failureOutcome(new Error("Couldn't reach the server."))).toEqual({ kind: 'unreachable' });
    for (const status of [502, 503, 521, 429, 409]) expect(failureOutcome(new ApiError(status, 'x'))).toEqual({ kind: 'unreachable' });
  });

  it('gives up on a refusal, and on an add the person has deleted since it went in', () => {
    expect(failureOutcome(new ApiError(400, 'Unknown category.'))).toEqual({ kind: 'refused', message: 'Unknown category.' });
    expect(failureOutcome(new ApiError(410, 'deleted'))).toEqual({ kind: 'gone' });
    expect(failureOutcome(new SignedOutError())).toEqual({ kind: 'signed-out' });
  });
});

describe('applyOutcome', () => {
  it('drops an add once it is in, unless its receipt is still to upload', () => {
    expect(applyOutcome([pending()], 'k1-0123456789abcdef', { kind: 'added', transactionId: 't1' })).toEqual([]);
    expect(applyOutcome([pending({ photo })], 'k1-0123456789abcdef', { kind: 'added', transactionId: 't1' })).toEqual([
      pending({ photo, transactionId: 't1' }),
    ]);
    expect(applyOutcome([pending({ photo, transactionId: 't1' })], 'k1-0123456789abcdef', { kind: 'receipt-done' })).toEqual([]);
  });

  it('keeps a refused add with its reason, but lets a refused receipt go', () => {
    expect(applyOutcome([pending()], 'k1-0123456789abcdef', { kind: 'refused', message: 'Unknown category.' })[0]?.error).toBe('Unknown category.');
    expect(applyOutcome([pending({ photo, transactionId: 't1' })], 'k1-0123456789abcdef', { kind: 'refused', message: 'x' })).toEqual([]);
  });

  it('leaves everything as it was when the server could not be reached, and touches only the one sent', () => {
    const items = [pending(), pending({ key: 'k2-0123456789abcdef' })];
    expect(applyOutcome(items, 'k1-0123456789abcdef', { kind: 'unreachable' })).toEqual(items);
    expect(applyOutcome(items, 'k1-0123456789abcdef', { kind: 'gone' })).toEqual([items[1]]);
  });
});

describe('sendable and outboxLine', () => {
  it('sends only what was not refused, and says what is waiting and what was refused', () => {
    const items = [pending(), pending({ key: 'k2-0123456789abcdef', error: 'Unknown category.' }), pending({ key: 'k3-0123456789abcdef' })];
    expect(sendable(items).map((i) => i.key)).toEqual(['k1-0123456789abcdef', 'k3-0123456789abcdef']);
    expect(outboxLine(items)).toBe(
      '2 entries are saved on this phone and will be added when your server can be reached. 1 was refused by the server.',
    );
    expect(outboxLine([])).toBeNull();
  });
});

describe('readOutbox', () => {
  it("reads only this sign-in's list, and nothing from a damaged file", () => {
    const raw = JSON.stringify({ deviceId: 'd1', items: [pending(), { nonsense: true }] });
    expect(readOutbox(raw, 'd1')).toEqual([pending()]);
    expect(readOutbox(raw, 'd2')).toEqual([]);
    expect(readOutbox('{not json', 'd1')).toEqual([]);
    expect(readOutbox(null, 'd1')).toEqual([]);
  });
});

describe('pendingLabel', () => {
  it('names an add by amount and title, else its category, else its kind', () => {
    expect(pendingLabel({ type: 'expense', amountCents: 1_250, title: ' Coffee ' }, 'CAD', 'Dining')).toMatch(/12\.50 Coffee$/);
    expect(pendingLabel({ type: 'expense', amountCents: 1_250 }, 'CAD', 'Dining')).toMatch(/12\.50 Dining$/);
    expect(pendingLabel({ type: 'transfer', amountCents: 5_000 }, 'CAD', null)).toMatch(/50\.00 Transfer$/);
  });
});
