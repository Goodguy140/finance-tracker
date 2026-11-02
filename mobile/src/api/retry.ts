import { ApiError, SignedOutError } from '@/api/client';

/** A refused request (signed out, a 4xx) gives the same answer again: only timeouts and 5xx are retried. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof SignedOutError) return false;
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}
