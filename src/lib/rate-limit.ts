type RateLimitState = {
  count: number;
  resetAt: number;
};

const windowState = new Map<string, RateLimitState>();

export function enforceSlidingWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  message: string,
) {
  const now = Date.now();
  const current = windowState.get(key);

  if (!current || current.resetAt <= now) {
    windowState.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= maxRequests) {
    throw new Error(message);
  }

  current.count += 1;
}
