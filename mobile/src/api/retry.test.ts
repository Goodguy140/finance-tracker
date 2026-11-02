import { describe, expect, it } from 'vitest';

import { ApiError, SignedOutError } from '@/api/client';
import { shouldRetry } from './retry';

describe('shouldRetry', () => {
  it('never retries a refusal, which would only be refused again', () => {
    expect(shouldRetry(0, new SignedOutError())).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'No such transaction.'))).toBe(false);
  });

  it('retries a server error or a dropped connection twice', () => {
    expect(shouldRetry(0, new ApiError(503, 'The server answered 503.'))).toBe(true);
    expect(shouldRetry(1, new Error("The server didn't answer."))).toBe(true);
    expect(shouldRetry(2, new Error("The server didn't answer."))).toBe(false);
  });
});
