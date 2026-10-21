/**
 * The client address behind the reverse proxy, for per-IP rate limits and the audit log.
 *
 * Each proxy appends the address it received the request from to `X-Forwarded-For`, so
 * only the entries those proxies added can be trusted; anything to their left is whatever
 * the client sent. `TRUSTED_PROXY_HOPS` (default 1) is how many proxies sit in front of the
 * app, and the client is the entry that many from the right. Reading the first entry
 * instead let anyone pick their own rate-limit bucket by sending the header themselves.
 * With no `X-Forwarded-For`, `X-Real-IP` is used as a proxy that overwrites would set it.
 */
export function clientIpFromForwardingHeaders(
  forwardedFor: string | null | undefined,
  realIp: string | null | undefined,
  trustedHopsRaw = process.env.TRUSTED_PROXY_HOPS,
): string | undefined {
  const hops = forwardedFor
    ?.split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (hops?.length) {
    // Fewer entries than proxies means a proxy overwrote the header; the leftmost is then
    // the earliest address any of them recorded.
    return hops[Math.max(0, hops.length - resolveTrustedProxyHops(trustedHopsRaw))];
  }
  return realIp?.trim() || undefined;
}

export function resolveTrustedProxyHops(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
