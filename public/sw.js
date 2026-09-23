/*
 * Finance Tracker service worker. Hand-written, no build step: it is served as-is from
 * `public/`, outside the session gate (`src/proxy.ts`), with `Cache-Control: no-cache`
 * (`next.config.ts`) so an update is picked up on the next navigation.
 *
 * What it caches, and why so little:
 *  - `/_next/static/*` — content-hashed, so cache-first is always correct.
 *  - The shell: the offline page and icons.
 *  - The dashboard (`/`) only, network-first, so the last copy can be *read* offline.
 *    Nothing else that carries user data is stored: settings, admin, MFA and auth pages
 *    go straight to the network. The dashboard copy is financial data at rest on the
 *    device, so it is purged on sign-out (`src/lib/pwa-cache.ts`, the `/login` page) and
 *    whenever the server bounces a dashboard request (signed out or re-auth required).
 *
 * Everything that is not a same-origin GET — server actions, API calls, Plaid — passes
 * through untouched. Offline writes are refused in the UI rather than queued here: a
 * silently replayed financial write is worse than one that visibly did not happen.
 *
 * `PRIVATE_CACHE` must match `PRIVATE_PAGES_CACHE` in `src/lib/pwa-cache.ts`
 * (`src/lib/pwa-cache.test.ts` checks it).
 */

const VERSION = "v1";
const STATIC_CACHE = `ft-static-${VERSION}`;
const SHELL_CACHE = `ft-shell-${VERSION}`;
const PRIVATE_CACHE = `ft-pages-${VERSION}`;
const KNOWN_CACHES = [STATIC_CACHE, SHELL_CACHE, PRIVATE_CACHE];

const OFFLINE_URL = "/offline";
const SHELL_URLS = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];
/** Hashed chunks from old deploys pile up otherwise; oldest are dropped first. */
const STATIC_CACHE_MAX_ENTRIES = 300;
/** Key for "the most recent dashboard", served when the exact URL was never cached. */
const LAST_DASHBOARD_KEY = "/__last-dashboard";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name.startsWith("ft-") && !KNOWN_CACHES.includes(name)).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "purge-private") {
    event.waitUntil(caches.delete(PRIVATE_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // RSC payloads for soft navigations: let them fail offline, and Next falls back to a
  // full navigation, which lands in the dashboard handler below.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticCacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(url.pathname === "/" ? dashboardNetworkFirst(request, url) : navigateOrOffline(request));
    return;
  }

  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

async function staticCacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trimCache(cache, STATIC_CACHE_MAX_ENTRIES);
  }
  return response;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

async function dashboardNetworkFirst(request, url) {
  let response;
  try {
    response = await fetch(request);
  } catch {
    return offlineDashboard(url);
  }

  // A navigation fetch does not follow redirects, so a session bounce arrives as an
  // opaque redirect. Whoever was signed in is not any more: drop their data.
  if (response.type === "opaqueredirect" || response.redirected) {
    await caches.delete(PRIVATE_CACHE);
    return response;
  }

  const contentType = response.headers.get("Content-Type") || "";
  if (response.ok && response.type === "basic" && contentType.includes("text/html")) {
    const cache = await caches.open(PRIVATE_CACHE);
    await cache.put(url.pathname + url.search, response.clone());
    await cache.put(LAST_DASHBOARD_KEY, response.clone());
  }
  return response;
}

async function offlineDashboard(url) {
  const cache = await caches.open(PRIVATE_CACHE);
  const hit = (await cache.match(url.pathname + url.search)) || (await cache.match(LAST_DASHBOARD_KEY));
  return hit ? markAsSavedCopy(hit) : offlinePage();
}

/**
 * Tags a cached page so it knows it is a saved copy (`SAVED_COPY_META` in
 * `src/lib/use-online-status.ts`). `navigator.onLine` alone cannot say so: it stays true
 * on Wi-Fi with no route to the server, which is exactly when this copy gets served.
 */
async function markAsSavedCopy(response) {
  const html = await response.text();
  const tagged = html.replace(/<head[^>]*>/i, (head) => `${head}<meta name="ft-saved-copy" content="1">`);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(tagged, { status: response.status, statusText: response.statusText, headers });
}

async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return offlinePage();
  }
}

async function offlinePage() {
  const hit = await caches.match(OFFLINE_URL);
  return hit || new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    }),
  );
});
