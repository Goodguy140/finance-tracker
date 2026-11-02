export type ServerAddress = { ok: true; origin: string } | { ok: false; error: string };

/**
 * What the person typed, as the origin the app talks to: `https://` is assumed when no scheme
 * is given, and anything that is not https is refused. The app sends a long-lived sign-in over
 * this connection, so it never falls back to plain http.
 */
export function parseServerAddress(input: string): ServerAddress {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Enter your server's address." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'The address must use https://, so your sign-in is never sent unencrypted.' };
  }
  if (!url.hostname || url.username || url.password) {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  return { ok: true, origin: url.origin };
}
