/**
 * Apple's app-site association file (`/.well-known/apple-app-site-association`). iOS fetches it,
 * through Apple's own servers, when an app that names this domain is installed or updated, and
 * lets that app use this domain's passkeys only if the file names the app.
 *
 * The phone app works with any Finance Tracker server, but it can be built for one: its home
 * server, whose domain is written into the app. Only that server sets `APPLE_APP_ID`, and only
 * then is the file served. Every other server answers 404, and the app signs in there through
 * the web page as before (`src/lib/app-devices.ts`).
 */

/** Team ID (ten characters) and bundle id, e.g. `ABCDE12345.com.example.finances`. */
const APP_ID_PATTERN = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** The configured app id, or null when it is unset or not shaped like one. */
export function appleAppId(raw: string | undefined = process.env.APPLE_APP_ID): string | null {
  const value = raw?.trim();
  return value && APP_ID_PATTERN.test(value) ? value : null;
}

/** `webcredentials`: the app may offer this domain's passkeys. */
export function appleAppSiteAssociation(appId: string) {
  return { webcredentials: { apps: [appId] } };
}
