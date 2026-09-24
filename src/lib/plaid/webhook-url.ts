/**
 * Where Plaid should deliver webhooks for this deployment, or null when it cannot.
 *
 * Plaid calls the URL from the public internet, so a loopback or plain-http address is
 * worse than none: every item linked with it would carry a URL that can never be reached,
 * and Plaid would keep retrying into the void. Null means "link without a webhook" — the
 * hourly sweep still discovers a broken connection, only later.
 *
 * `PLAID_WEBHOOK_URL` wins when set (a reverse proxy that exposes only some paths, say);
 * otherwise the URL is derived from `NEXTAUTH_URL`, the one place this app already records
 * its public origin.
 */

export const PLAID_WEBHOOK_PATH = "/api/plaid/webhook";

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "[::1]" || h.startsWith("127.");
}

function publicHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (isLoopbackHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function resolvePlaidWebhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.PLAID_WEBHOOK_URL?.trim();
  if (explicit) return publicHttpsUrl(explicit)?.toString() ?? null;

  const origin = env.NEXTAUTH_URL?.trim();
  if (!origin) return null;
  const base = publicHttpsUrl(origin);
  if (!base) return null;
  return new URL(PLAID_WEBHOOK_PATH, base.origin).toString();
}
