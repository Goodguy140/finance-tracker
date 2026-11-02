import { describe, expect, it } from 'vitest';

import { lockMethodName, RELOCK_AFTER_MS, shouldRelock } from './app-lock';

describe('shouldRelock', () => {
  it('locks again only after five minutes away, and never without having been away', () => {
    expect(shouldRelock(null, 10 * RELOCK_AFTER_MS)).toBe(false);
    expect(shouldRelock(1_000, 1_000 + RELOCK_AFTER_MS - 1)).toBe(false);
    expect(shouldRelock(1_000, 1_000 + RELOCK_AFTER_MS)).toBe(true);
  });
});

describe('lockMethodName', () => {
  it('names what the phone has', () => {
    expect(lockMethodName({ face: true, fingerprint: false })).toBe('Face ID');
    expect(lockMethodName({ face: false, fingerprint: true })).toBe('Touch ID');
    expect(lockMethodName({ face: false, fingerprint: false })).toBe('Passcode');
  });
});
