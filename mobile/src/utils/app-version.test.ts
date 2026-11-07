import { describe, expect, it } from 'vitest';

import { buildText, publishedText, shortRuntime, updateText, type RunningCode } from './app-version';

const update: RunningCode = {
  enabled: true,
  updateId: '0f3c2a9e-5b1d-4c7e-9a8f-2d6b4e1c3a57',
  createdAt: new Date(2026, 10, 7, 3, 2),
  channel: 'production',
  runtimeVersion: 'd2e495ad3adbcb79ca5361faec8c2b38be9dc1a7',
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
};

describe('about this app', () => {
  it('gives the version and build as TestFlight lists them', () => {
    expect(buildText({ version: '0.1.0', build: '17' })).toBe('0.1.0 (build 17)');
    expect(buildText({ version: '0.1.0', build: null })).toBe('0.1.0');
    expect(buildText({ version: null, build: null })).toBe('Unknown');
  });

  it('says when the running update was published', () => {
    expect(updateText(update, 'en-US')).toEqual({ value: 'Published Nov 7, 2026, 3:02 AM', note: null });
    expect(publishedText(new Date(2026, 0, 31, 18, 45), 'en-US')).toBe('Published Jan 31, 2026, 6:45 PM');
  });

  it("says when the phone runs the build's own code, and why", () => {
    expect(updateText({ ...update, isEmbeddedLaunch: true }, 'en-US')).toEqual({
      value: 'None',
      note: 'Running the code this build came with.',
    });
    expect(updateText({ ...update, updateId: null }, 'en-US').value).toBe('None');
    expect(updateText({ ...update, isEmergencyLaunch: true }, 'en-US')).toEqual({
      value: 'None',
      note: 'The last update could not start, so the app went back to the code this build came with.',
    });
    expect(updateText({ ...update, enabled: false }, 'en-US').value).toBe('Off');
  });

  it('shortens a fingerprint runtime and leaves any other as it is', () => {
    expect(shortRuntime(update.runtimeVersion)).toBe('d2e495a');
    expect(shortRuntime('0.1.0')).toBe('0.1.0');
    expect(shortRuntime(null)).toBeNull();
  });
});
