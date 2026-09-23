/**
 * The service worker's cache of the dashboard (`public/sw.js`, `PRIVATE_CACHE`). It holds
 * the last-viewed dashboard HTML — financial data at rest on the device — so offline
 * reading works. Anything that ends a session must drop it.
 */
export const PRIVATE_PAGES_CACHE = "ft-pages-v1";

/**
 * Deletes the cached dashboard. Called on the `/login` page (every sign-out path lands
 * there) and just before client-side `signOut`. Safe everywhere: no-ops where the Cache
 * API or service workers are unavailable, and never throws.
 */
export async function purgePrivateCaches(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if ("caches" in window) await caches.delete(PRIVATE_PAGES_CACHE);
  } catch {
    // Storage may be blocked (private mode); there is nothing cached to purge then.
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "purge-private" });
  } catch {
    // No controlling worker: nothing more to do.
  }
}
