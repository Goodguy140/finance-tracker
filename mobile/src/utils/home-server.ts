/*
 * The app's home server: the one Finance Tracker server a build of the app is made for. Its
 * domain is set when building (`HOME_SERVER_DOMAIN`, read by app.config.ts) and never written in
 * the repository. iOS lets the app use that domain's passkeys, and only that domain's, because
 * the app's entitlements name it and the server's Apple app-site association names the app.
 *
 * The app still signs in to any server, as it always has. On another server the features that
 * need that pairing are not offered, and the sign-in screen says so.
 */

/** Whether a server origin (`https://host`, from `parseServerAddress`) is the home server. */
export function isHomeServer(origin: string, home: string | null): boolean {
  if (!home) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.host === home;
  } catch {
    return false;
  }
}
